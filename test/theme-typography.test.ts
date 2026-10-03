import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

// Theme typography from styles (ticket 10). Expected values are written here, not read from the code.
type TypeStyle = {fontFamily?: string; fontSize: number; fontWeight: number; letterSpacing?: number; lineHeightPx?: number; lineHeightUnit?: string; lineHeightPercentFontSize?: number; textCase?: string};
const box = {x: 0, y: 0, width: 100, height: 20};
const text = (id: string, name: string, style: TypeStyle, styleId?: string) =>
    ({id, name, type: 'TEXT', characters: 'Sample', style, absoluteBoundingBox: box, ...(styleId ? {styles: {text: styleId}} : {})});
const frame = (...children: object[]) => ({id: '95:1', name: 'Type scale', type: 'FRAME', children});
const inter = (fontSize: number, extra: Partial<TypeStyle> = {}): TypeStyle => ({fontFamily: 'Inter', fontSize, fontWeight: 400, letterSpacing: 0, ...extra});

/** Runs extract_theme_typography into a temp project; returns the report and the generated files. */
async function extract(
    t: {after: (fn: () => Promise<void>) => void},
    root: {id: string},
    opts: {styles?: Record<string, {name: string; styleType: string}>; generateTextTheme?: boolean; extraArgs?: Record<string, unknown>} = {},
) {
    const dir = mkdtempSync(join(tmpdir(), 'theme-typography-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const result = await callToolOffline(
        nodeRoute(root.id, root, opts.styles),
        'extract_theme_typography',
        {fileId: FILE_KEY, nodeId: root.id, projectPath: dir, generateTextTheme: opts.generateTextTheme ?? false, ...opts.extraArgs},
    );
    const file = (name: string) => {
        const path = join(dir, 'lib', 'theme', name);
        return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
    };
    return {report: result.text, appText: file('app_text.dart'), textTheme: file('text_theme.dart')};
}

test('a style keeps its own font family, and no shared family constant is generated', async (t) => {
    const {appText} = await extract(t, frame(
        text('95:2', 'Alpha', inter(16)),
        text('95:3', 'Beta', inter(16)),
        text('95:4', 'Gamma', inter(16)),
        text('95:5', 'Code', {...inter(14), fontFamily: 'JetBrains Mono'}),
    ));

    assert.match(appText!, /static const TextStyle code = TextStyle\(\s*fontFamily: 'JetBrains Mono'/);
    assert.match(appText!, /static const TextStyle alpha = TextStyle\(\s*fontFamily: 'Inter'/);
    assert.doesNotMatch(appText!, /static const String/);
});

test('extract_theme_typography has no familyVariableName input', async () => {
    const {withServer} = await import('./helpers/mcp-stdio.ts');
    let properties: Record<string, unknown> = {};
    await withServer(async (server) => {
        await server.initialize();
        const reply: any = await server.request('tools/list', {});
        properties = reply.result.tools.find((tool: any) => tool.name === 'extract_theme_typography').inputSchema.properties;
    });

    assert.deepEqual(Object.keys(properties).sort(), ['fileId', 'generateTextTheme', 'nodeId', 'projectPath']);
});
