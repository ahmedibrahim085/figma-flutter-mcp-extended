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
