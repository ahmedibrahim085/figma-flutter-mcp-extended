import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, callToolsOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';
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

    assert.match(limited.text, /Child Layers \(1 identified\)/);
    assert.match(limited.text, /increase the maxChildNodes parameter/);
    assert.match(old.text, /Child Layers \(2 identified\)/);
});

test('showAllChildren includes hidden child layers in inspect_frame_structure; showAllSections no longer does', async () => {
    const shown = await call(SCREEN, 'inspect_frame_structure', {showAllChildren: true});
    const old = await call(SCREEN, 'inspect_frame_structure', {showAllSections: true});

    assert.match(shown.text, /Hidden/);
    assert.doesNotMatch(old.text, /Hidden \(FRAME\)/);
    assert.match(old.text, /Use showAllChildren: true/);
});

test('resetCachedStyles clears the cached styles before analysis; resetStyleLibrary no longer does', async () => {
    const args = {input: FILE_KEY, nodeId: TEXT_FRAME.id, exportAssets: false, userDefinedComponent: true};
    const usage = async (extra: object) => {
        const [, second] = await callToolsOffline(nodeRoute(TEXT_FRAME.id, TEXT_FRAME),
            [['analyze_figma_component', args], ['analyze_figma_component', {...args, ...extra}]]);
        return second.text.match(/Total style usage: (\d+)/)?.[1];
    };

    // Each analysis uses 2 cached styles; a reset drops the first call's use from the total.
    assert.equal(await usage({resetCachedStyles: true}), '2');
    assert.equal(await usage({resetStyleLibrary: true}), '4');
});

test('report headings use Figma and Flutter terms', async () => {
    const plain = await call(TEXT_FRAME, 'analyze_figma_component', {exportAssets: false, userDefinedComponent: true, useDeduplication: false});
    // A URL input adds the layout map section to the report.
    const screen = await call(SCREEN, 'analyze_frame_as_screen',
        {input: `https://www.figma.com/design/${FILE_KEY}/x?node-id=30-1`, extractAssets: false});
    const status = await callToolOffline({}, 'cached_styles_status', {});

    assert.match(plain.text, /Child layers \(1 analyzed\)/);
    assert.match(screen.text, /Layout sizing \(FIXED\/HUG\/FILL\)/);
    assert.match(screen.text, /Layout map for AI Implementation/);
    assert.match(screen.text, /Name-based layer classification/);
    assert.match(screen.text, /Child Widgets:/);
    assert.match(status.text, /Cached styles/);
    for (const old of [/Child Elements/, /Layout Sizing Semantics/, /Visual Context/, /Enhanced Semantic Detection/, /Section Widgets/, /Style Library/]) {
        for (const {text} of [plain, screen, status]) assert.doesNotMatch(text, old);
    }
});

test('tool descriptions use Figma and Flutter terms', async () => {
    let descriptions: Record<string, string> = {};
    await withServer(async (s) => {
        await s.initialize();
        const list: any = await s.request('tools/list');
        descriptions = Object.fromEntries(list.result.tools.map((t: any) => [t.name, t.description]));
    });
    const all = Object.values(descriptions).join('\n');

    assert.match(descriptions.ff_get_variable_defs, /^Read the variables/);
    assert.match(descriptions.inspect_color_frame, /frame of color samples/);
    assert.match(descriptions.inspect_text_style_frame, /frame of text samples/);
    assert.match(descriptions.ff_get_screenshot, /top-level frames/);
    for (const tool of ['analyze_frame_as_screen', 'inspect_frame_structure']) {
        assert.match(descriptions[tool], /child layers/);
        assert.doesNotMatch(descriptions[tool], /sections/);
    }
    for (const old of [/design tokens/i, /theme frame/i, /typography frame/i, /full screens/i, /complete screen/i, /screen frames/i, /full design context/i, /style library/i]) {
        assert.doesNotMatch(all, old);
    }
});
