// The analysis tools cap nothing by count or depth: every child, section and level is reported.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

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
