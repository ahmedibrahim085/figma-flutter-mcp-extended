import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, callToolsOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';
import {mkdtempSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withServer} from './helpers/mcp-stdio.ts';

// Independent source of truth: Figma and Flutter documentation terms (research-terms.md, ticket 19).
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
const child = (id: string, name: string, extra: object = {}) =>
    ({id, name, type: 'FRAME', absoluteBoundingBox: box(375, 100), ...extra});
const SCREEN = {
    id: '30:1', name: 'Screen', type: 'FRAME', absoluteBoundingBox: box(375, 812),
    children: [child('30:2', 'First'), child('30:3', 'Second'), child('30:4', 'Hidden', {visible: false})],
};
const TEXT_FRAME = {
    id: '31:1', name: 'Holder', type: 'FRAME', layoutMode: 'VERTICAL', fills: [],
    children: [{id: '31:2', name: 'Label', type: 'TEXT', characters: 'Label', fills: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}],
        style: {fontFamily: 'Inter', fontSize: 16, fontWeight: 400, letterSpacing: 0, lineHeightPx: 24, lineHeightUnit: 'PIXELS'}}],
};

const call = (node: {id: string}, tool: string, args: object) =>
    callToolOffline(nodeRoute(node.id, node), tool, {input: FILE_KEY, nodeId: node.id, ...args});

test('maxChildNodes limits the child layers analyze_frame_as_screen reports; maxSections no longer does', async () => {
    const limited = await call(SCREEN, 'analyze_frame_as_screen', {extractAssets: false, maxChildNodes: 1});
    const old = await call(SCREEN, 'analyze_frame_as_screen', {extractAssets: false, maxSections: 1});

    assert.match(limited.text, /Child layers \(1 identified\)/);
    assert.match(limited.text, /increase the maxChildNodes parameter/);
    assert.match(old.text, /Child layers \(2 identified\)/);
});

test('showAllChildren includes hidden child layers in inspect_frame_structure; showAllSections no longer does', async () => {
    const shown = await call(SCREEN, 'inspect_frame_structure', {showAllChildren: true});
    const old = await call(SCREEN, 'inspect_frame_structure', {showAllSections: true});

    assert.match(shown.text, /Hidden/);
    assert.doesNotMatch(old.text, /Hidden \(FRAME\)/);
    assert.match(old.text, /Use showAllChildren: true/);
});

test('style totals count the current call only; resetCachedStyles and resetStyleLibrary are ignored', async () => {
    const args = {input: FILE_KEY, nodeId: TEXT_FRAME.id, exportAssets: false, userDefinedComponent: true};
    const usage = async (extra: object) => {
        const [, second] = await callToolsOffline(nodeRoute(TEXT_FRAME.id, TEXT_FRAME),
            [['analyze_figma_component', args], ['analyze_figma_component', {...args, ...extra}]]);
        return second.text.match(/Total style usage: (\d+)/)?.[1];
    };

    // Each analysis uses 2 styles; the first call's use is never in the second call's total.
    assert.equal(await usage({}), '2');
    assert.equal(await usage({resetCachedStyles: true}), '2');
    assert.equal(await usage({resetStyleLibrary: true}), '2');
});

test('report headings use Figma and Flutter terms', async () => {
    const plain = await call(TEXT_FRAME, 'analyze_figma_component', {exportAssets: false, userDefinedComponent: true, useDeduplication: false});
    // A URL input adds the layout map section to the report.
    const screen = await call(SCREEN, 'analyze_frame_as_screen',
        {input: `https://www.figma.com/design/${FILE_KEY}/x?node-id=30-1`, extractAssets: false});

    assert.match(plain.text, /Child layers \(1 analyzed\)/);
    assert.match(screen.text, /Layout sizing \(FIXED\/HUG\/FILL\)/);
    assert.match(screen.text, /Screen layout map for AI Implementation/);
    assert.match(screen.text, /Child widgets:/);
    for (const old of [/Child Layers \(/, /Child Widgets:/, /Screen Layout map/, /child elements/i, /Child Elements/, /Layout Sizing Semantics/, /Visual Context/, /Enhanced Semantic Detection/, /Section Widgets/, /Style Library/]) {
        for (const {text} of [plain, screen]) assert.doesNotMatch(text, old);
    }
});

const INVENTED_TERMS = /theme frame|typography frame|\bsections?\b|child elements|style library|design tokens|full screens|complete screen layouts|screen frames|full design context|swatch/i;

test('tool descriptions and input descriptions use Figma and Flutter terms', async () => {
    let tools: any[] = [];
    await withServer(async (s) => {
        await s.initialize();
        const list: any = await s.request('tools/list');
        tools = list.result.tools;
    });
    const descriptions: Record<string, string> = Object.fromEntries(tools.map((t) => [t.name, t.description]));

    assert.match(descriptions.ff_get_variable_defs, /^Read the variables/);
    assert.match(descriptions.inspect_color_frame, /frame of color samples/);
    assert.match(descriptions.inspect_text_style_frame, /frame of text samples/);
    assert.match(descriptions.ff_get_screenshot, /top-level frames/);
    for (const tool of ['analyze_frame_as_screen', 'inspect_frame_structure']) {
        assert.match(descriptions[tool], /child layers/);
    }
    // Every description of a tool and of each of its inputs, case-insensitive. Figma's own SECTION
    // node is documented, so ff_get_screenshot may say "not sections or pages".
    const texts: string[] = [];
    for (const t of tools) {
        if (t.name !== 'ff_get_screenshot') texts.push(`${t.name}: ${t.description}`);
        else texts.push(`${t.name}: ${t.description.replace('not sections or pages', '')}`);
        for (const [key, prop] of Object.entries<any>(t.inputSchema?.properties ?? {})) texts.push(`${t.name}.${key}: ${prop.description ?? ''}`);
    }
    for (const text of texts) assert.doesNotMatch(text, INVENTED_TERMS, text);
    const byKey = (tool: string, key: string) => tools.find((t) => t.name === tool).inputSchema.properties[key].description;
    assert.equal(byKey('analyze_frame_as_screen', 'maxChildNodes'), 'Maximum child layers to analyze (default: 15)');
    assert.equal(byKey('inspect_frame_structure', 'showAllChildren'), 'Show all child layers regardless of limits (default: false)');
    assert.equal(byKey('extract_theme_colors', 'nodeId'), 'Node ID of the frame of color samples');
    assert.equal(byKey('extract_theme_typography', 'nodeId'), 'Node ID of the frame of text samples');
});

test('extract_theme_colors and extract_theme_typography name the frame, not a theme frame', async (t) => {
    const colors = {id: '40:1', name: 'Palette', type: 'FRAME', children: [
        {id: '40:2', name: 'Primary', type: 'RECTANGLE', fills: [{type: 'SOLID', color: {r: 0.1, g: 0.2, b: 0.3, a: 1}}], absoluteBoundingBox: box(40, 40)},
        {id: '40:3', name: 'Primary label', type: 'TEXT', characters: 'Primary', absoluteBoundingBox: box(40, 20)},
    ]};
    const dir = mkdtempSync(join(tmpdir(), 'theme-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const base = {fileId: FILE_KEY, projectPath: dir};
    const c = await callToolOffline(nodeRoute(colors.id, colors), 'extract_theme_colors', {...base, nodeId: colors.id});
    const y = await callToolOffline(nodeRoute(TEXT_FRAME.id, TEXT_FRAME), 'extract_theme_typography', {...base, nodeId: TEXT_FRAME.id});

    for (const {text} of [c, y]) {
        assert.match(text, /^Successfully extracted/);
        assert.match(text, /\nFrame: /);
        assert.doesNotMatch(text, INVENTED_TERMS);
    }
});
