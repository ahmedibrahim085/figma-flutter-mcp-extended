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
    const text = await toolText(nestedFrames(11));

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

/** A root frame holding `levels` nested frames, the innermost carrying a 7 px rectangle. */
function nestedFrames(levels: number) {
    let node: any = {id: '46:99', name: 'Leaf', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(7, 7)};
    for (let depth = levels; depth >= 1; depth--) {
        node = {id: `46:${depth}`, name: `Level ${depth}`, type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(100, 100), children: [node]};
    }
    return {id: '46:0', name: 'Root', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(100, 100), children: [node]};
}

test('content eight levels below the component renders; the ninth level is an approximation', async () => {
    const eight = await toolText(nestedFrames(7));
    assert.match(eight, /width: 7,/);
    assert.doesNotMatch(eight, /approximate:/);

    const nine = await toolText(nestedFrames(8));
    assert.doesNotMatch(nine, /width: 7,/);
    assert.match(nine, /\/\/ approximate: "Level 8" is deeper than 8 levels; its children are not rendered/);
});

test('a layer name with a line break stays inside its approximation comment', async () => {
    const text = await toolText({
        id: '47:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(200, 80),
        children: [{id: '47:2', name: 'Line one\nLine two', type: 'INSTANCE', componentId: '9:9', fills: [], absoluteBoundingBox: box(32, 32), children: []}],
    });

    assert.match(text, /\/\/ approximate: component "Line one Line two" is not inlined; analyze it separately\n\s*SizedBox\(width: 32, height: 32\)/);
    assert.match(text, /Approximations:\n- component "Line one Line two" is not inlined; analyze it separately\n/);
});

test('a frame at the depth limit whose children are all hidden is not named as an approximation', async () => {
    const root = nestedFrames(8);
    let level: any = root;
    while (level.children[0].type === 'FRAME') level = level.children[0];
    level.children[0].visible = false;
    // Its own fill keeps the frame visible; without one, a frame of hidden children is skipped as invisible.
    level.fills = [RED];

    assert.doesNotMatch(await toolText(root), /approximate:/);
});

test('a nested frame keeps its own padding', async () => {
    const code = await widgetCode({
        id: '48:1', name: 'Outer', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(200, 80),
        children: [{
            id: '48:2', name: 'Padded', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(200, 40),
            paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8,
            children: [{id: '48:3', name: 'Dot', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(10, 10)}],
        }],
    });

    assert.ok(dedent(code).includes(['Container(', 'padding: paddingID,', 'child: Row(', 'children: [', 'Container(', 'width: 10,'].join('\n')), code);
});

test('an empty frame without decoration keeps its space as a sized box', async () => {
    const code = await widgetCode({
        id: '49:1', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(100, 20),
        children: [{id: '49:2', name: 'Spacer', type: 'FRAME', fills: [], absoluteBoundingBox: box(24, 8), children: []}],
    });

    assert.match(code, /children: \[\n\s+SizedBox\(width: 24, height: 8\),\n/);
});

test('a boolean operation renders as its bounding box, named as an approximation, its operands not rendered', async () => {
    const text = await toolText({
        id: '56:1', name: 'Icons', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(100, 30),
        children: [
            {id: '56:2', name: 'Union', type: 'BOOLEAN_OPERATION', fills: [RED], absoluteBoundingBox: box(30, 30), children: [
                {id: '56:3', name: 'a', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(20, 20)},
                {id: '56:4', name: 'b', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(20, 20)},
            ]},
            {id: '56:5', name: 'Badge', type: 'STAR', fills: [RED], absoluteBoundingBox: box(12, 12)},
        ],
    });

    assert.match(text, /\/\/ approximate: "Union" \(BOOLEAN_OPERATION\) is drawn as its bounding box\n\s*Container\(\n\s*width: 30,\n\s*height: 30,\n\s*decoration: decorationID,/);
    assert.match(text, /\/\/ approximate: "Badge" \(STAR\) is drawn as its bounding box\n\s*Container\(\n\s*width: 12,/);
    assert.doesNotMatch(text, /width: 20,/);
    assert.match(text, /Approximations:\n- "Union" \(BOOLEAN_OPERATION\) is drawn as its bounding box\n- "Badge" \(STAR\) is drawn as its bounding box\n/);
});

test('a frame cut off at the depth limit keeps its own size and decoration', async () => {
    const root = nestedFrames(9);
    let level: any = root;
    while (level.name !== 'Level 8') level = level.children[0];
    level.fills = [RED];

    assert.match(await toolText(root), /\/\/ approximate: "Level 8" is deeper than 8 levels; its children are not rendered\n\s*Container\(\n\s*width: 100,\n\s*height: 100,\n\s*decoration: decorationID,\n\s*\)/);
});
