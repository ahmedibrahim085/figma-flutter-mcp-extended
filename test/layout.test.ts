// Slice 2 (layout): the generated widget tree mirrors the Figma layer tree.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, normalizeStyleIds, FILE_KEY} from './helpers/offline-tool.ts';

const RED = {type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}};
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});

/** Generated widget class for `node` on the default path, style ids normalised. */
async function widgetCode(node: {id: string}): Promise<string> {
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component',
        {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true});
    const start = text.indexOf('class ');
    assert.ok(start >= 0, `no generated class in:\n${text}`);
    return normalizeStyleIds(text.slice(start));
}

/** The whole tool text (report + code), style ids normalised. */
async function toolText(node: {id: string}): Promise<string> {
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component',
        {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true});
    return normalizeStyleIds(text);
}

/** Each line trimmed, so nesting depth does not change the comparison. */
const dedent = (code: string) => code.split('\n').map((line) => line.trim()).join('\n');

test('a nested frame renders as a container around its own Row, three levels deep', async () => {
    const code = await widgetCode({
        id: '41:1', name: 'Outer', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(200, 80),
        children: [{
            id: '41:2', name: 'Inner', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], absoluteBoundingBox: box(200, 40),
            children: [{id: '41:3', name: 'Deep', type: 'TEXT', characters: 'Deep', fills: [], style: {fontFamily: 'Inter', fontSize: 14, fontWeight: 400}}],
        }],
    });

    assert.ok(dedent(code).includes([
        'child: Column(',
        'children: [',
        'Container(',
        'decoration: decorationID,',
        'child: Row(',
        'children: [',
        'Text(',
        "'Deep',",
    ].join('\n')), code);
});

test('a rectangle renders as a sized box with its decoration', async () => {
    const code = await widgetCode({
        id: '42:1', name: 'Swatches', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(100, 20),
        children: [{id: '42:2', name: 'Swatch', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40, 20)}],
    });

    assert.ok(dedent(code).includes(['child: Row(', 'children: [', 'Container(', 'width: 40,', 'height: 20,', 'decoration: decorationID,', '),'].join('\n')), code);
});

test('a hidden child renders nothing', async () => {
    const code = await widgetCode({
        id: '43:1', name: 'Holder', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(100, 20),
        children: [
            {id: '43:2', name: 'Shown', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40, 20)},
            {id: '43:3', name: 'Hidden', type: 'RECTANGLE', visible: false, fills: [RED], absoluteBoundingBox: box(30, 20)},
        ],
    });

    assert.match(code, /width: 40,/);
    assert.doesNotMatch(code, /width: 30,/);
});

test('frames deeper than the depth limit are named as approximations, in the code and in the tool output', async () => {
    // Twelve nested frames; the innermost carries a 7 px rectangle that the depth limit cuts off.
    let node: any = {id: '44:99', name: 'Leaf', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(7, 7)};
    for (let depth = 12; depth >= 1; depth--) {
        node = {id: `44:${depth}`, name: `Level ${depth}`, type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(100, 100), children: [node]};
    }
    const text = await toolText(node);

    assert.match(text, /\/\/ approximate: "Level \d+" is deeper than 8 levels; its children are not rendered/);
    assert.match(text, /Approximations:\n(?:- [^\n]*\n)*- "Level \d+" is deeper than 8 levels; its children are not rendered/);
    assert.doesNotMatch(text, /width: 7,/);
});

test('a nested component instance renders as a placeholder named for separate analysis', async () => {
    const text = await toolText({
        id: '45:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(200, 80),
        children: [{id: '45:2', name: 'Avatar', type: 'INSTANCE', componentId: '9:9', fills: [RED], absoluteBoundingBox: box(32, 32), children: []}],
    });

    assert.match(text, /\/\/ approximate: component "Avatar" is not inlined; analyze it separately\n\s*SizedBox\(width: 32, height: 32\)/);
    assert.match(text, /Approximations:\n(?:- [^\n]*\n)*- component "Avatar" is not inlined; analyze it separately/);
});
