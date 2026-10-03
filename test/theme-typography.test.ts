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

const SLOTS = ['displayLarge', 'displayMedium', 'displaySmall', 'headlineLarge', 'headlineMedium', 'headlineSmall',
    'titleLarge', 'titleMedium', 'titleSmall', 'bodyLarge', 'bodyMedium', 'bodySmall', 'labelLarge', 'labelMedium', 'labelSmall'];
const slotPath = (slot: string) => slot.replace(/([A-Z])/, '/$1').replace(/^./, (c) => c.toUpperCase());

test('15 styles named after the TextTheme slots fill exactly those 15 slots', async (t) => {
    const styles: Record<string, {name: string; styleType: string}> = {};
    const nodes = SLOTS.map((slot, i) => {
        styles[`S:${i}`] = {name: slotPath(slot), styleType: 'TEXT'};
        return text(`95:${10 + i}`, `Layer ${i}`, inter(10 + i * 2), `S:${i}`);
    });
    const {textTheme, report} = await extract(t, frame(...nodes), {styles, generateTextTheme: true});

    const lines = textTheme!.split('\n').filter((line) => /^\s+\w+: AppText\.\w+,$/.test(line)).map((line) => line.trim());
    assert.deepEqual(lines, SLOTS.map((slot) => `${slot}: AppText.${slot},`));
    assert.doesNotMatch(report, /Unfilled TextTheme slots/);
});

test('a 20 px style on a 24 px line emits height 1.2 and letterSpacing 0', async (t) => {
    const {appText} = await extract(t, frame(text('95:2', 'Body', inter(20, {lineHeightPx: 24, lineHeightUnit: 'PIXELS'}))));

    assert.match(appText!, /height: 1\.2\b/);
    assert.match(appText!, /letterSpacing: 0\b/);
});

test('a letter spacing of -0.5 px is emitted as -0.5', async (t) => {
    const {appText} = await extract(t, frame(text('95:2', 'Tight', inter(32, {letterSpacing: -0.5}))));

    assert.match(appText!, /letterSpacing: -0\.5\b/);
});

test('a style without a family gets no Roboto and no fontFamily, and inspect_text_style_frame says missing', async (t) => {
    const noFamily = {fontSize: 14, fontWeight: 400, letterSpacing: 0};
    const root = frame(text('95:2', 'Plain', noFamily));
    const {report, appText} = await extract(t, root, {generateTextTheme: true});
    const inspect = await callToolOffline(nodeRoute(root.id, root), 'inspect_text_style_frame', {fileId: FILE_KEY, nodeId: root.id});

    assert.doesNotMatch(report + appText!, /Roboto/);
    assert.doesNotMatch(appText!, /fontFamily/);
    assert.match(report, /Font: missing/);
    assert.match(inspect.text, /Font: missing/);
    assert.doesNotMatch(inspect.text, /Roboto|default/);
});

test('the style name wins over the layer name; a layer with no style keeps its own name', async (t) => {
    const {appText} = await extract(t, frame(
        text('95:2', 'Rectangle 1', inter(32), 'S:1'),
        text('95:3', 'Caption sample', inter(12)),
    ), {styles: {'S:1': {name: 'Heading/H1', styleType: 'TEXT'}}});

    assert.match(appText!, /static const TextStyle h1 = /);
    assert.match(appText!, /static const TextStyle captionSample = /);
    assert.doesNotMatch(appText!, /rectangle1/);
});

test('a name with a prefix such as M3/body/large fills no slot, and the report lists the unfilled slots', async (t) => {
    const {report, textTheme, appText} = await extract(t, frame(text('95:2', 'x', inter(16), 'S:1')),
        {styles: {'S:1': {name: 'M3/body/large', styleType: 'TEXT'}}, generateTextTheme: true});

    assert.equal(textTheme, undefined);
    assert.match(appText!, /static const TextStyle large = /);
    assert.match(report, /No style name equals a TextTheme slot/);
    assert.match(report, /Unfilled TextTheme slots: displayLarge, displayMedium/);
});

test('Body/Large fills bodyLarge whatever the other styles are called, and a name that is not an identifier uses its full path', async (t) => {
    const {textTheme, appText} = await extract(t, frame(
        text('95:2', 'a', inter(16), 'S:1'),
        text('95:3', 'b', inter(14), 'S:2'),
    ), {styles: {'S:1': {name: 'Body/Large', styleType: 'TEXT'}, 'S:2': {name: 'Size/12', styleType: 'TEXT'}}, generateTextTheme: true});

    assert.match(appText!, /static const TextStyle large = /);
    assert.match(appText!, /static const TextStyle size12 = /);
    assert.match(textTheme!, /bodyLarge: AppText\.large,/);
});

test('two styles with one name and different values are reported and not generated', async (t) => {
    const {report, appText} = await extract(t, frame(
        text('95:2', 'Twin', inter(16)),
        text('95:3', 'Twin', inter(18)),
        text('95:4', 'Solo', inter(12)),
    ));

    assert.doesNotMatch(appText!, /twin/);
    assert.match(appText!, /static const TextStyle solo = /);
    assert.match(report, /Note: not generated: "Twin".*another style has the same name/);
});

test('usage examples name a generated constant and carry no made-up font size', async (t) => {
    const {report} = await extract(t, frame(text('95:2', 'Heading/H1', inter(32))), {generateTextTheme: true});

    assert.match(report, /Text\('Hello World', style: AppText\.h1\)/);
    assert.doesNotMatch(report, /fontSize: 16|AppText\.fontFamily/);
});
