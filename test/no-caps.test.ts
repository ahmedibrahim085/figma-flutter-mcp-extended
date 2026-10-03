// The analysis tools cap nothing by count or depth: every child, section and level is reported.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';
import {withServer} from './helpers/mcp-stdio.ts';

const RED = {type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}};
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});

/** A chain of `levels` nested frames L1..Ln whose innermost child is a TEXT reading "DEEPEST". */
function chain(levels: number) {
    let node: any = {id: '80:99', name: 'Leaf', type: 'TEXT', characters: 'DEEPEST', fills: [RED], absoluteBoundingBox: box(60, 12),
        style: {fontFamily: 'Inter', fontSize: 12, fontWeight: 400, letterSpacing: 0, lineHeightPx: 14, lineHeightUnit: 'PIXELS'}};
    for (let depth = levels; depth >= 1; depth--) {
        node = {id: `80:${depth}`, name: `L${depth}`, type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(100, 100), children: [node]};
    }
    return {id: '80:0', name: 'Root', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(100, 100), children: [node]};
}

test('generate_flutter_implementation keeps content below eight levels', async () => {
    const root = chain(10);
    const {text} = await callToolOffline(nodeRoute(root.id, root), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: root.id});

    assert.match(text, /'DEEPEST'/);
    assert.doesNotMatch(text, /deeper than/);
});

test('analyze_figma_component with generateFlutterCode keeps content below eight levels', async () => {
    const root = chain(10);
    const {text} = await callToolOffline(nodeRoute(root.id, root), 'analyze_figma_component',
        {input: FILE_KEY, nodeId: root.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true});

    assert.match(text, /'DEEPEST'/);
    assert.doesNotMatch(text, /deeper than/);
});

const screenOf = (children: object[], id = '81:0') => ({id, name: 'Home', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(375, 812), children});
const rect = (id: string, name: string) => ({id, name, type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40, 40)});
const screenText = async (node: {id: string}) =>
    (await callToolOffline(nodeRoute(node.id, node), 'analyze_frame_as_screen', {input: FILE_KEY, nodeId: node.id, extractAssets: false})).text;

test('a 16-section screen reports 16 child layers and names no skipped layer', async () => {
    const text = await screenText(screenOf(Array.from({length: 16}, (_, i) => rect(`81:${i + 1}`, `S${i + 1}`))));

    assert.match(text, /Child layers \(16 identified\)/);
    assert.match(text, /16\. S16 \(RECTANGLE, 81:16\)/);
    assert.doesNotMatch(text, /skipped|Analysis Limitations|max_child_nodes/);
});

test('a layer with 25 children reports all 25 in the screen evidence', async () => {
    const holder = {id: '81:50', name: 'Holder', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(200, 800),
        children: Array.from({length: 25}, (_, i) => rect(`81:6${i}`, `G${i + 1}`))};
    const text = await screenText(screenOf([{id: '81:40', name: 'Section', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(375, 812), children: [holder]}]));

    for (const n of [1, 20, 21, 25]) assert.match(text, new RegExp(`- G${n}: `), `G${n} is missing`);
});

test('a screen reports levels below four: a ten-level chain prints L10', async () => {
    const text = await screenText(screenOf([chain(10).children[0]]));

    assert.match(text, /- L10: /);
});

test('inspect_frame_structure lists 21 child layers and no "more" line', async () => {
    const node = screenOf(Array.from({length: 21}, (_, i) => rect(`81:${i + 1}`, `S${i + 1}`)));
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'inspect_frame_structure', {input: FILE_KEY, nodeId: node.id});

    assert.match(text, /S21/);
    assert.doesNotMatch(text, /more child layers|showAllChildren: true/);
});

test('inspect_component_structure lists 16 children and no "more" line', async () => {
    const node = screenOf(Array.from({length: 16}, (_, i) => rect(`81:${i + 1}`, `C${i + 1}`)));
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'inspect_component_structure', {input: FILE_KEY, nodeId: node.id, userDefinedComponent: true});

    assert.match(text, /C16/);
    assert.doesNotMatch(text, /more children|showAllChildren: true/);
});

// ── the response budget bounds the size instead ─────────────────────────────

const BUDGET = 100000;
const textChild = (id: string, i: number) => ({id, name: `T${i}`, type: 'TEXT', characters: `c${i}`, fills: [RED], absoluteBoundingBox: box(60, 12),
    style: {fontFamily: 'Inter', fontSize: 12, fontWeight: 400, letterSpacing: 0, lineHeightPx: 14, lineHeightUnit: 'PIXELS'}});
const bigFrame = (count: number) => ({id: '82:0', name: 'Big', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(300, 5000),
    children: Array.from({length: count}, (_, i) => textChild(`82:${i + 1}`, i + 1))});

/** The omitted ids a cut report names, and how many of the children it kept. */
function cutReport(text: string, kept: RegExp) {
    const omitted = (text.match(/^omittedNodeIds: (.*)$/m)?.[1] ?? '').split(', ').filter(Boolean);
    return {omitted, keptCount: (text.match(kept) ?? []).length};
}

test('generate_flutter_implementation over the budget is cut at whole nodes, with a placeholder and an id for each', async () => {
    const root = bigFrame(700);
    const {text} = await callToolOffline(nodeRoute(root.id, root), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: root.id});

    const {omitted, keptCount} = cutReport(text, /'c\d+'/g);
    assert.ok(text.length <= BUDGET, `${text.length} characters`);
    assert.match(text, /^truncated: true$/m);
    assert.ok(omitted.length > 0 && keptCount > 0, `kept ${keptCount}, omitted ${omitted.length}`);
    assert.equal(keptCount + omitted.length, 700);
    for (const id of omitted) assert.ok(text.includes(`// approximate: ${id} left out to fit the response budget`), `no placeholder for ${id}`);
});

test('a frame within the budget is not cut', async () => {
    const root = bigFrame(10);
    const {text} = await callToolOffline(nodeRoute(root.id, root), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: root.id});

    assert.doesNotMatch(text, /truncated: true|omittedNodeIds/);
});

test('the analysis tools declare the response budget to the client', async () => {
    let tools: any[] = [];
    await withServer(async (server) => {
        await server.initialize();
        tools = ((await server.request('tools/list')).result as any).tools;
    });

    for (const name of ['generate_flutter_implementation', 'analyze_figma_component', 'analyze_frame_as_screen', 'inspect_frame_structure', 'inspect_component_structure']) {
        assert.equal(tools.find((tool) => tool.name === name)?._meta?.['anthropic/maxResultSizeChars'], BUDGET, name);
    }
});

const frameOf = (count: number, nodeId = '83:0') => ({id: nodeId, name: 'Big', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(375, 5000),
    children: Array.from({length: count}, (_, i) => rect(`83:${i + 1}`, `Layer ${i + 1}`))});

/** Each of `ids` is a child of a report that was cut: it is listed in omittedNodeIds, or printed as an entry. */
function everyChildOnce(text: string, count: number) {
    const omitted = new Set((text.match(/^omittedNodeIds: (.*)$/m)?.[1] ?? '').split(', ').filter(Boolean));
    for (let i = 1; i <= count; i++) {
        const id = `83:${i}`;
        const entries = (text.match(new RegExp(`Layer ${i} \\(`, 'g')) ?? []).length;
        assert.equal(entries + (omitted.has(id) ? 1 : 0), 1, `${id}: ${entries} entries, ${omitted.has(id) ? 'also' : 'not'} omitted`);
    }
    return omitted;
}

for (const [tool, args] of [
    ['analyze_frame_as_screen', {extractAssets: false}],
    ['inspect_frame_structure', {}],
    ['inspect_component_structure', {userDefinedComponent: true}],
    ['analyze_figma_component', {exportAssets: false, userDefinedComponent: true}],
] as Array<[string, Record<string, unknown>]>) {
    test(`${tool} over the budget is cut at whole child layers; every child is an entry or in omittedNodeIds`, async () => {
        const count = 1500;
        const node = frameOf(count);
        const {text} = await callToolOffline(nodeRoute(node.id, node), tool, {input: FILE_KEY, nodeId: node.id, ...args});

        assert.ok(text.length <= BUDGET, `${text.length} characters`);
        assert.match(text, /^truncated: true$/m);
        const omitted = everyChildOnce(text, count);
        assert.ok(omitted.size > 0 && omitted.size < count, `omitted ${omitted.size}`);
    });
}
