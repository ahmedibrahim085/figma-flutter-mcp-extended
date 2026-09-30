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
        'width: 200,',
        'height: 40,',
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

    assert.ok(dedent(code).includes(['Container(', 'width: 200,', 'height: 40,', 'padding: paddingID,', 'child: Row(', 'children: [', 'Container(', 'width: 10,'].join('\n')), code);
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

test('a nested frame with nothing but children renders its Row or Column directly', async () => {
    const code = await widgetCode({
        id: '57:1', name: 'Outer', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(200, 80),
        children: [{id: '57:2', name: 'Bare', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(200, 40),
            layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
            children: [{id: '57:3', name: 'Dot', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(10, 10)}]}],
    });

    assert.ok(dedent(code).includes(['child: Column(', 'children: [', 'Row(', 'children: [', 'Container(', 'width: 10,'].join('\n')), code);
});

test('a shape without a fill keeps its space as a sized box', async () => {
    const text = await toolText({
        id: '58:1', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(100, 20),
        children: [
            {id: '58:2', name: 'Gap', type: 'RECTANGLE', fills: [], absoluteBoundingBox: box(7, 7)},
            {id: '58:3', name: 'Cut', type: 'BOOLEAN_OPERATION', fills: [], absoluteBoundingBox: box(9, 9), children: []},
        ],
    });

    assert.match(text, /children: \[\n\s+SizedBox\(width: 7, height: 7\),\n/);
    assert.match(text, /\/\/ approximate: "Cut" \(BOOLEAN_OPERATION\) is drawn as its bounding box\n\s*SizedBox\(width: 9, height: 9\),/);
});

// Ticket 02: only a FIXED axis carries pixels; a HUG main axis shrinks to its children.
const sized = (horizontal: string | undefined, vertical: string | undefined) =>
    ({layoutSizingHorizontal: horizontal, layoutSizingVertical: vertical});

test('a FIXED component root carries its size', async () => {
    const code = await widgetCode({
        id: '50:1', name: 'Bar', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], absoluteBoundingBox: box(320, 48), ...sized('FIXED', 'FIXED'),
        children: [{id: '50:2', name: 'Dot', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(10, 10), ...sized('FIXED', 'FIXED')}],
    });

    assert.match(code, /    return Container\(\n      width: 320,\n      height: 48,\n      decoration: decorationID,\n/);
});

test('a HUG component root carries no size and its Row shrinks to its children', async () => {
    const code = await widgetCode({
        id: '51:1', name: 'Chip', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], absoluteBoundingBox: box(90, 24), ...sized('HUG', 'HUG'),
        children: [{id: '51:2', name: 'Dot', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(10, 10), ...sized('FIXED', 'FIXED')}],
    });

    assert.doesNotMatch(code, /width: 90|height: 24/);
    assert.match(code, /      child: Row\(\n        mainAxisSize: MainAxisSize\.min,\n        children: \[/);
});

test('a nested FIXED frame carries both sizes; a nested HUG column carries none and shrinks', async () => {
    const code = await widgetCode({
        id: '52:1', name: 'Outer', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(400, 100), ...sized('FIXED', 'FIXED'),
        children: [
            {id: '52:2', name: 'Fixed', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], absoluteBoundingBox: box(120, 60), ...sized('FIXED', 'FIXED'),
                children: [{id: '52:3', name: 'A', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(11, 11), ...sized('FIXED', 'FIXED')}]},
            {id: '52:4', name: 'Hug', type: 'FRAME', layoutMode: 'VERTICAL', fills: [RED], absoluteBoundingBox: box(33, 77), ...sized('HUG', 'HUG'),
                children: [{id: '52:5', name: 'B', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(12, 12), ...sized('FIXED', 'FIXED')}]},
        ],
    });

    assert.ok(dedent(code).includes(['Container(', 'width: 120,', 'height: 60,', 'decoration: decorationID,', 'child: Row(', 'children: ['].join('\n')), code);
    assert.ok(dedent(code).includes(['Container(', 'decoration: decorationID,', 'child: Column(', 'mainAxisSize: MainAxisSize.min,', 'children: ['].join('\n')), code);
    assert.doesNotMatch(code, /width: 33|height: 77/);
});

test('a FILL shape carries no pixels on its FILL axis', async () => {
    const code = await widgetCode({
        id: '53:1', name: 'Track', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(300, 20), ...sized('FIXED', 'FIXED'),
        children: [{id: '53:2', name: 'Bar', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(268, 8), layoutGrow: 1, ...sized('FILL', 'FIXED')}],
    });

    assert.doesNotMatch(code, /width: 268/);
    assert.ok(dedent(code).includes(['Expanded(', 'child: Container(', 'height: 8,', 'decoration: decorationID,', '),'].join('\n')), code);
});

test('a HUG text carries no width', async () => {
    const code = await widgetCode({
        id: '54:1', name: 'Label row', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(200, 20), ...sized('FIXED', 'FIXED'),
        children: [{id: '54:2', name: 'Label', type: 'TEXT', characters: 'Hello', fills: [], absoluteBoundingBox: box(87, 17), ...sized('HUG', 'HUG'),
            style: {fontFamily: 'Inter', fontSize: 14, fontWeight: 400, textAutoResize: 'WIDTH_AND_HEIGHT'}}],
    });

    assert.match(code, /'Hello'/);
    assert.doesNotMatch(code, /width: 87|height: 17/);
});

test('a shape outside auto layout keeps its pixel size', async () => {
    const code = await widgetCode({
        id: '55:1', name: 'Canvas', type: 'FRAME', fills: [], absoluteBoundingBox: box(200, 120), ...sized('FIXED', 'FIXED'),
        children: [{id: '55:2', name: 'Blob', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(44, 22)}],
    });

    assert.ok(dedent(code).includes(['Container(', 'width: 44,', 'height: 22,', 'decoration: decorationID,'].join('\n')), code);
});

test('a FIXED frame without decoration keeps its size and its children', async () => {
    const code = await widgetCode({
        id: '59:1', name: 'Outer', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(300, 100), ...sized('FIXED', 'FIXED'),
        children: [{id: '59:2', name: 'Slot', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(150, 50), ...sized('FIXED', 'FIXED'),
            children: [{id: '59:3', name: 'Dot', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(10, 10), ...sized('FIXED', 'FIXED')}]}],
    });

    assert.ok(dedent(code).includes(['Container(', 'width: 150,', 'height: 50,', 'child: Row(', 'children: [', 'Container(', 'width: 10,'].join('\n')), code);
});

test('a childless FIXED frame with a fill (a divider) carries its size', async () => {
    const code = await widgetCode({
        id: '61:1', name: 'List', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(200, 50), ...sized('FIXED', 'HUG'),
        children: [{id: '61:2', name: 'Divider', type: 'FRAME', fills: [RED], absoluteBoundingBox: box(200, 1), ...sized('FIXED', 'FIXED'), children: []}],
    });

    assert.ok(dedent(code).includes(['Container(', 'width: 200,', 'height: 1,', 'decoration: decorationID,', ')'].join('\n')), code);
});
