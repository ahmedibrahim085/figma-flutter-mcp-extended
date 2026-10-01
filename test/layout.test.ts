// Slice 2 (layout): the generated widget tree mirrors the Figma layer tree.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
        'crossAxisAlignment: CrossAxisAlignment.start,',
        'children: [',
        'Container(',
        'width: 200,',
        'height: 40,',
        'decoration: decorationID,',
        'child: Row(',
        'crossAxisAlignment: CrossAxisAlignment.start,',
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

    assert.ok(dedent(code).includes(['child: Row(', 'crossAxisAlignment: CrossAxisAlignment.start,', 'children: [', 'Container(', 'width: 40,', 'height: 20,', 'decoration: decorationID,', '),'].join('\n')), code);
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

    assert.ok(dedent(code).includes(['Container(', 'width: 200,', 'height: 40,', 'padding: paddingID,', 'child: Row(', 'crossAxisAlignment: CrossAxisAlignment.start,', 'children: [', 'Container(', 'width: 10,'].join('\n')), code);
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
            layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG',
            children: [{id: '57:3', name: 'Dot', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(10, 10)}]}],
    });

    assert.ok(dedent(code).includes(['child: Column(', 'crossAxisAlignment: CrossAxisAlignment.start,', 'children: [', 'Row(', 'mainAxisSize: MainAxisSize.min,', 'crossAxisAlignment: CrossAxisAlignment.start,', 'children: [', 'Container(', 'width: 10,'].join('\n')), code);
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
    assert.match(code, /      child: Row\(\n        mainAxisSize: MainAxisSize\.min,\n        crossAxisAlignment: CrossAxisAlignment\.start,\n        children: \[/);
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

    assert.ok(dedent(code).includes(['Container(', 'width: 120,', 'height: 60,', 'decoration: decorationID,', 'child: Row(', 'crossAxisAlignment: CrossAxisAlignment.start,', 'children: ['].join('\n')), code);
    assert.ok(dedent(code).includes(['Container(', 'decoration: decorationID,', 'child: Column(', 'mainAxisSize: MainAxisSize.min,', 'crossAxisAlignment: CrossAxisAlignment.start,', 'children: ['].join('\n')), code);
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

test('a FIXED frame without decoration keeps its size and its children in a SizedBox', async () => {
    const code = await widgetCode({
        id: '59:1', name: 'Outer', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(300, 100), ...sized('FIXED', 'FIXED'),
        children: [{id: '59:2', name: 'Slot', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(150, 50), ...sized('FIXED', 'FIXED'),
            children: [{id: '59:3', name: 'Dot', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(10, 10), ...sized('FIXED', 'FIXED')}]}],
    });

    // A size-only Container trips sized_box_for_whitespace; SizedBox holds the same size and child.
    assert.ok(dedent(code).includes(['SizedBox(', 'width: 150,', 'height: 50,', 'child: Row(', 'crossAxisAlignment: CrossAxisAlignment.start,', 'children: [', 'Container(', 'width: 10,'].join('\n')), code);
});

test('a childless FIXED frame with a fill (a divider) carries its size', async () => {
    const code = await widgetCode({
        id: '61:1', name: 'List', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(200, 50), ...sized('FIXED', 'HUG'),
        children: [{id: '61:2', name: 'Divider', type: 'FRAME', fills: [RED], absoluteBoundingBox: box(200, 1), ...sized('FIXED', 'FIXED'), children: []}],
    });

    assert.ok(dedent(code).includes(['Container(', 'width: 200,', 'height: 1,', 'decoration: decorationID,', ')'].join('\n')), code);
});

test('a FIXED size is rounded to whole pixels, and a node without a bounding box carries no size', async () => {
    const code = await widgetCode({
        id: '62:1', name: 'Strip', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], ...sized('FIXED', 'FIXED'),
        children: [{id: '62:2', name: 'Chip', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40.6, 19.4), ...sized('FIXED', 'FIXED')}],
    });

    assert.match(code, /    return Container\(\n      decoration: decorationID,\n/);
    assert.doesNotMatch(code, /width: 0,|height: 0,/);
    assert.ok(dedent(code).includes(['Container(', 'width: 41,', 'height: 19,', 'decoration: decorationID,'].join('\n')), code);
});

test('a placeholder drops its pixels on a FILL axis but keeps its measured size on a HUG axis', async () => {
    const text = await toolText({
        id: '63:1', name: 'Bar', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(300, 40), ...sized('FIXED', 'FIXED'),
        children: [
            {id: '63:2', name: 'Search', type: 'INSTANCE', componentId: '9:9', fills: [], absoluteBoundingBox: box(220, 32), ...sized('FILL', 'HUG'), children: []},
            {id: '63:3', name: 'Avatar', type: 'INSTANCE', componentId: '9:8', fills: [], absoluteBoundingBox: box(32, 32), ...sized('HUG', 'HUG'), children: []},
        ],
    });

    assert.match(text, /Expanded\(\n\s*child: \/\/ approximate: component "Search" is not inlined; analyze it separately\n\s*SizedBox\(height: 32\),/);
    assert.match(text, /\/\/ approximate: component "Avatar" is not inlined; analyze it separately\n\s*SizedBox\(width: 32, height: 32\),/);
    assert.doesNotMatch(text, /width: 220/);
});

const inter = (extra: object = {}) => ({fontFamily: 'Inter', fontSize: 14, fontWeight: 400, lineHeightPx: 20, lineHeightUnit: 'PIXELS', ...extra});

test('a FIXED-width text block carries its width, so it wraps where Figma wraps it', async () => {
    const code = await widgetCode({
        id: '64:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(300, 100), ...sized('FIXED', 'HUG'),
        children: [{id: '64:2', name: 'Body', type: 'TEXT', characters: 'Wraps at 150', fills: [], absoluteBoundingBox: box(150, 40), ...sized('FIXED', 'HUG'),
            style: inter({textAutoResize: 'HEIGHT'})}],
    });

    assert.ok(dedent(code).includes(['SizedBox(', 'width: 150,', 'child: Text(', "'Wraps at 150',"].join('\n')), code);
});

test('a FIXED-width, fixed-height centred text puts both sizes on one SizedBox', async () => {
    const code = await widgetCode({
        id: '65:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(300, 100), ...sized('FIXED', 'HUG'),
        children: [{id: '65:2', name: 'Title', type: 'TEXT', characters: 'Centred', fills: [], absoluteBoundingBox: box(150, 48), ...sized('FIXED', 'FIXED'),
            style: inter({textAutoResize: 'NONE', textAlignVertical: 'CENTER'})}],
    });

    assert.ok(dedent(code).includes(['SizedBox(', 'width: 150,', 'height: 48,', 'child: Align('].join('\n')), code);
    assert.equal(code.match(/SizedBox\(/g)?.length, 1, code);
});

test('a placeholder that fills a column drops its height', async () => {
    const text = await toolText({
        id: '66:1', name: 'Page', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(300, 600), ...sized('FIXED', 'FIXED'),
        children: [{id: '66:2', name: 'Feed', type: 'INSTANCE', componentId: '9:7', fills: [], absoluteBoundingBox: box(300, 540), ...sized('FIXED', 'FILL'), children: []}],
    });

    assert.match(text, /Expanded\(\n\s*child: \/\/ approximate: component "Feed" is not inlined; analyze it separately\n\s*SizedBox\(width: 300\),/);
    assert.doesNotMatch(text, /height: 540/);
});

// Ticket 03: alignment and gaps. Figma omits MIN alignment in REST, and Flutter's Row/Column default the counter axis to center,
// so a frame with no counterAxisAlignItems (MIN) emits CrossAxisAlignment.start.
const textNode = (id: string, characters: string, fontSize = 14) =>
    ({id, name: characters, type: 'TEXT', characters, fills: [], absoluteBoundingBox: box(40, fontSize), style: inter({fontSize})});
const dot = (id: string) => ({id, name: 'Dot', type: 'ELLIPSE', fills: [RED], absoluteBoundingBox: box(10, 10), ...sized('FIXED', 'FIXED')});
/** A probe frame from the alignment fixture: a REST read of frames created in Figma for this ticket. */
const alignmentFrame = (name: string) => JSON.parse(readFileSync(new URL('./fixtures/alignment-frame.json', import.meta.url), 'utf-8'))
    .nodes['2:14'].document.children.find((child: any) => child.name === name);

test('the item gap becomes a SizedBox between children, none at either end', async () => {
    const row = dedent(await widgetCode({
        id: '70:1', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', itemSpacing: 12, fills: [], absoluteBoundingBox: box(100, 10), ...sized('HUG', 'HUG'),
        children: [dot('70:2'), dot('70:3'), dot('70:4')],
    }));
    assert.equal(row.match(/SizedBox\(width: 12\),/g)?.length, 2, row);
    assert.ok(row.includes('children: [\nContainer('), row);
    assert.ok(row.includes('),\n],'), row);

    const column = dedent(await widgetCode({
        id: '71:1', name: 'Column', type: 'FRAME', layoutMode: 'VERTICAL', itemSpacing: 8, fills: [], absoluteBoundingBox: box(10, 100), ...sized('HUG', 'HUG'),
        children: [dot('71:2'), dot('71:3')],
    }));
    assert.equal(column.match(/SizedBox\(height: 8\),/g)?.length, 1, column);
});

test('primary and counter alignment map to Flutter, and only non-default values are emitted', async () => {
    const code = (primary?: string, counter?: string) => widgetCode({
        id: '72:1', name: 'Bar', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(200, 40), ...sized('FIXED', 'FIXED'),
        ...(primary ? {primaryAxisAlignItems: primary} : {}), ...(counter ? {counterAxisAlignItems: counter} : {}),
        children: [dot('72:2'), dot('72:3')],
    });
    const defaults = await code();
    assert.doesNotMatch(defaults, /mainAxisAlignment:/);
    assert.match(defaults, /child: Row\(\n\s+crossAxisAlignment: CrossAxisAlignment\.start,\n\s+children: \[/);

    const centred = await code('CENTER', 'CENTER');
    assert.match(centred, /child: Row\(\n\s+mainAxisAlignment: MainAxisAlignment\.center,\n\s+children: \[/);
    assert.doesNotMatch(centred, /crossAxisAlignment:/);

    assert.match(await code('MAX', 'MAX'), /mainAxisAlignment: MainAxisAlignment\.end,\n\s+crossAxisAlignment: CrossAxisAlignment\.end,/);
});

test('SPACE_* alignment from a real file maps to Flutter and drops the gap', async () => {
    const around = await widgetCode(alignmentFrame('Probe / around fixed'));
    assert.match(around, /mainAxisAlignment: MainAxisAlignment\.spaceAround,/);
    assert.match(await widgetCode(alignmentFrame('Probe / evenly fixed')), /mainAxisAlignment: MainAxisAlignment\.spaceEvenly,/);
    const hug = await widgetCode(alignmentFrame('Probe / between hug'));
    // Figma lays out a HUG + SPACE_BETWEEN frame with touching children (width 150 = 3 × 50, gap ignored); a shrunk Row
    // does the same, so no note is needed (and no alignment: see the HUG test below).
    for (const code of [around, hug]) assert.doesNotMatch(code, /SizedBox\(width: 12\)/);
});

test('a negative gap from a real file is dropped and named as an approximation', async () => {
    const out = await toolText(alignmentFrame('Probe / negative gap'));
    assert.match(out, /\/\/ approximate: "Probe \/ negative gap" has a negative gap \(-10\); the overlap is not reproduced\n\s*Row\(/);
    assert.match(out, /Approximations:\n(?:- [^\n]*\n)*- "Probe \/ negative gap" has a negative gap \(-10\); the overlap is not reproduced/);
    assert.doesNotMatch(out, /SizedBox\(width: -10\)/);
});

test('BASELINE emits textBaseline, and names non-text children as an approximation', async () => {
    const node = (children: object[]) => ({
        id: '73:1', name: 'Price', type: 'FRAME', layoutMode: 'HORIZONTAL', counterAxisAlignItems: 'BASELINE', fills: [],
        absoluteBoundingBox: box(200, 40), ...sized('HUG', 'HUG'), children,
    });
    const textsOnly = await toolText(node([textNode('73:2', '$', 12), textNode('73:3', '42', 32)]));
    assert.match(textsOnly, /crossAxisAlignment: CrossAxisAlignment\.baseline,\n\s+textBaseline: TextBaseline\.alphabetic,/);
    assert.doesNotMatch(textsOnly, /approximate:/);

    const mixed = await toolText(node([textNode('73:4', '42', 32), dot('73:5')]));
    assert.match(mixed, /\/\/ approximate: "Price" aligns to the text baseline; its non-text children sit at the top/);
});

test('an unknown primary alignment is named as an approximation and left at start', async () => {
    const out = await toolText({
        id: '74:1', name: 'Odd', type: 'FRAME', layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_SIDEWAYS', fills: [],
        absoluteBoundingBox: box(200, 40), ...sized('FIXED', 'FIXED'), children: [dot('74:2')],
    });
    assert.match(out, /\/\/ approximate: "Odd" has primary-axis alignment SPACE_SIDEWAYS; start is used/);
    assert.doesNotMatch(out, /mainAxisAlignment:/);
});

test('a frame without auto layout gets no alignment arguments', async () => {
    const code = await widgetCode({
        id: '75:1', name: 'Canvas', type: 'FRAME', fills: [], clipsContent: true, absoluteBoundingBox: box(200, 100), ...sized('FIXED', 'FIXED'),
        primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', itemSpacing: 10,
        children: [dot('75:2'), dot('75:3')],
    });

    // Ticket 05: a frame without auto layout is a Stack of positioned children; no alignment, no gap.
    assert.match(code, /child: Stack\(\n\s+children: \[/);
    assert.doesNotMatch(code, /AxisAlignment|SizedBox\(height: 10\)/);
});

test('a HUG main axis emits no main-axis alignment: there is no free space for it to move', async () => {
    const hug = await widgetCode(alignmentFrame('Probe / between hug'));
    assert.match(hug, /child: Row\(\n\s+mainAxisSize: MainAxisSize\.min,\n\s+crossAxisAlignment: CrossAxisAlignment\.start,\n\s+children: \[/);
    assert.doesNotMatch(hug, /mainAxisAlignment:/);
});

test('layoutMode NONE is not auto layout', async () => {
    const code = await widgetCode({
        id: '76:1', name: 'Plain', type: 'FRAME', layoutMode: 'NONE', itemSpacing: 12, fills: [], absoluteBoundingBox: box(200, 100), ...sized('FIXED', 'FIXED'),
        children: [dot('76:2'), dot('76:3')],
    });
    assert.doesNotMatch(code, /AxisAlignment|SizedBox\(height: 12\)/);
});

test('a negative gap under SPACE_* is not named: Figma ignores the gap there too', async () => {
    const out = await toolText({
        id: '77:1', name: 'Spread', type: 'FRAME', layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_BETWEEN', itemSpacing: -6, fills: [],
        absoluteBoundingBox: box(200, 20), ...sized('FIXED', 'FIXED'), children: [dot('77:2'), dot('77:3')],
    });
    assert.doesNotMatch(out, /negative gap/);
});

test('an unknown primary alignment on a HUG axis is not named: it would have no visible effect', async () => {
    const out = await toolText({
        id: '78:1', name: 'Hugger', type: 'FRAME', layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_SIDEWAYS', fills: [],
        absoluteBoundingBox: box(40, 10), ...sized('HUG', 'HUG'), children: [dot('78:2'), dot('78:3')],
    });
    assert.doesNotMatch(out, /primary-axis alignment/);
});

// Ticket 04: FILL and stretch. Owner decisions 2026-09-30: FILL in a HUG main axis keeps its measured size; a FILL root gets
// LimitedBox; cross-axis FILL is a per-child SizedBox(double.infinity); a HUG cross axis with FILL children gets Intrinsic*.
const layoutCase = (name: string) => JSON.parse(readFileSync(new URL('./fixtures/layout-frame.json', import.meta.url), 'utf-8'))
    .nodes['1:34'].document.children.find((child: any) => child.name === name);

test('real fixture: a main-axis FILL child is Expanded without pixels on its FILL axis; two FILL siblings are both Expanded', async () => {
    const one = dedent(await widgetCode(layoutCase('Layout / main-axis FILL')));
    assert.ok(one.includes(['Expanded(', 'child: Container(', 'height: 40,', 'decoration: decorationID,', '),', '),'].join('\n')), one);
    assert.doesNotMatch(one, /width: 268/);
    const two = dedent(await widgetCode(layoutCase('Layout / two FILL siblings')));
    assert.equal(two.match(/Expanded\(\nchild: Container\(\nheight: 40,/g)?.length, 2, two);
});

test('real fixture: a cross-axis FILL child fills the cross axis in its own SizedBox; its FIXED sibling is untouched', async () => {
    const code = dedent(await widgetCode(layoutCase('Layout / cross-axis FILL')));
    assert.ok(code.includes(['SizedBox(', 'height: double.infinity,', 'child: Container(', 'width: 80,', 'decoration: decorationID,'].join('\n')), code);
    assert.ok(code.includes(['Container(', 'width: 80,', 'height: 40,'].join('\n')), code);
    assert.doesNotMatch(code, /CrossAxisAlignment\.stretch|IntrinsicHeight/);
});

test('a FILL child in a HUG main axis keeps its measured size, like Figma', async () => {
    const code = dedent(await widgetCode({
        id: '90:1', name: 'Chips', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(130, 20), ...sized('HUG', 'HUG'),
        children: [dot('90:2'), {id: '90:3', name: 'Grow', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(80, 20), layoutGrow: 1, ...sized('FILL', 'FIXED')}],
    }));
    assert.doesNotMatch(code, /Expanded|Flexible/);
    assert.ok(code.includes(['Container(', 'width: 80,', 'height: 20,', 'decoration: decorationID,'].join('\n')), code);
});

test('a HUG cross axis with a cross-axis FILL child is wrapped in IntrinsicHeight / IntrinsicWidth', async () => {
    const row = dedent(await widgetCode({
        id: '91:1', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], absoluteBoundingBox: box(200, 40), ...sized('FIXED', 'HUG'),
        children: [{id: '91:2', name: 'Tall', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(20, 40), ...sized('FIXED', 'FIXED')},
            {id: '91:3', name: 'Bar', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(20, 20), ...sized('FIXED', 'FILL')}],
    }));
    assert.ok(row.includes(['child: IntrinsicHeight(', 'child: Row('].join('\n')), row);
    assert.ok(row.includes(['SizedBox(', 'height: double.infinity,', 'child: Container(', 'width: 20,'].join('\n')), row);

    const column = dedent(await widgetCode({
        id: '92:1', name: 'Col', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(40, 200), ...sized('HUG', 'FIXED'),
        children: [{id: '92:2', name: 'Wide', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40, 20), ...sized('FIXED', 'FIXED')},
            {id: '92:3', name: 'Line', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(20, 2), ...sized('FILL', 'FIXED')}],
    }));
    assert.ok(column.includes(['child: IntrinsicWidth(', 'child: Column('].join('\n')), column);
    assert.ok(column.includes(['SizedBox(', 'width: double.infinity,', 'child: Container(', 'height: 2,'].join('\n')), column);
});

test('a component root with a FILL axis falls back to its Figma size in an unbounded host (LimitedBox)', async () => {
    const code = await widgetCode({
        id: '93:1', name: 'Banner', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], absoluteBoundingBox: box(360, 48), ...sized('FILL', 'FIXED'),
        children: [{id: '93:2', name: 'Grow', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(300, 20), layoutGrow: 1, ...sized('FILL', 'FIXED')}],
    });
    assert.match(code, /    return LimitedBox\(\n      maxWidth: 360,\n      child: Container\(\n        width: double\.infinity,\n        height: 48,\n        decoration: decorationID,\n/);
});

test('a FILL root fills a bounded host on either axis: double.infinity inside the LimitedBox', async () => {
    const code = await widgetCode({
        id: '94:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL', fills: [RED], absoluteBoundingBox: box(360, 40), ...sized('FILL', 'HUG'),
        children: [dot('94:2')],
    });
    assert.match(code, /    return LimitedBox\(\n      maxWidth: 360,\n      child: Container\(\n        width: double\.infinity,\n        decoration: decorationID,\n/);
});

test('a FILL root without a measured size asks for no infinite size and gets no zero cap', async () => {
    const code = await widgetCode({
        id: '99:1', name: 'Unsized', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], ...sized('FILL', 'FIXED'),
        absoluteBoundingBox: {x: 0, y: 0, width: 0, height: 48}, children: [dot('99:2')],
    });
    // Nothing to cap at: an uncapped double.infinity throws in a horizontal scroll or a Row (Spec review render check).
    assert.doesNotMatch(code, /maxWidth: 0|double\.infinity/);
});

// Ticket 05: absolute children and constraints (research 05; owner decisions 2026-10-01). Positions are the child's box minus
// the parent's; the Stack sits outside the frame padding with StackFit.passthrough so the flow keeps today's constraints.
const at = (x: number, y: number, width: number, height: number) => ({x, y, width, height});
const pinned = (id: string, name: string, box: object, horizontal: string, vertical: string, extra: object = {}) =>
    ({id, name, type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box, constraints: {horizontal, vertical}, ...extra});
const plainFrame = (children: object[], extra: object = {}) => ({
    id: '100:1', name: 'Canvas', type: 'FRAME', fills: [], clipsContent: true, absoluteBoundingBox: at(0, 0, 100, 100),
    ...sized('FIXED', 'FIXED'), children, ...extra,
});

test('real fixture: an ABSOLUTE child in auto layout sits in a Stack outside the padding, the flow Row sizing it', async () => {
    const code = dedent(await widgetCode(layoutCase('Layout / absolute child')));
    assert.ok(code.includes(['child: Stack(', 'fit: StackFit.passthrough,', 'children: [', 'Padding(', 'padding: paddingID,', 'child: Row('].join('\n')), code);
    assert.ok(code.includes(['Positioned(', 'left: 150,', 'top: -4,', 'width: 16,', 'height: 16,', 'child: Container('].join('\n')), code);
    assert.doesNotMatch(code, /\nContainer\(\ndecoration: decorationID,\npadding: paddingID,/);
    assert.equal(code.match(/width: 16,/g)?.length, 2, code);
});

test('real fixture: a frame without auto layout is a Stack of children placed by their constraints', async () => {
    const code = dedent(await widgetCode(layoutCase('Layout / plain frame (Stack)')));
    assert.ok(code.includes(['child: Stack(', 'children: ['].join('\n')), code);
    assert.ok(code.includes(['Positioned(', 'left: 0,', 'top: 0,', 'width: 200,', 'height: 120,'].join('\n')), code);
    assert.ok(code.includes(['Positioned(', 'right: 10,', 'bottom: 10,', 'width: 60,', 'height: 30,'].join('\n')), code);
    assert.doesNotMatch(code, /child: Column\(/);
});

test('constraint recipes: LEFT_RIGHT/TOP_BOTTOM stretch, CENTER pads then aligns, SCALE aligns then sizes by fraction', async () => {
    const code = dedent(await widgetCode(plainFrame([
        pinned('100:2', 'Stretch', at(10, 20, 70, 30), 'LEFT_RIGHT', 'TOP_BOTTOM'),
        pinned('100:3', 'Centred', at(55, 40, 20, 20), 'CENTER', 'CENTER'),
        pinned('100:4', 'Scaled', at(10, 0, 70, 50), 'SCALE', 'TOP'),
    ])));
    assert.ok(code.includes(['Positioned(', 'left: 10,', 'right: 20,', 'top: 20,', 'bottom: 50,'].join('\n')), code);
    // CENTER: the box keeps the frame size, shifted by s = x + w/2 - W/2 = 15 (Positioned left: s, right: -s), then
    // Align(0, ...) and SizedBox(w). A Padding of 2s squashed children that cross the frame edge (ticket 05 Spec review).
    assert.ok(code.includes(['Positioned(', 'left: 15,', 'right: -15,', 'top: 0,', 'bottom: 0,', 'child: Align(',
        'alignment: Alignment(0, 0),', 'child: SizedBox(', 'width: 20,', 'height: 20,'].join('\n')), code);
    assert.doesNotMatch(code, /EdgeInsets\.only/);
    // SCALE: alignment x = 2·10/(100−70) − 1 = -0.3333; widthFactor 70/100 = 0.7; TOP keeps top/height on the Positioned.
    assert.ok(code.includes(['Positioned(', 'left: 0,', 'right: 0,', 'top: 0,', 'height: 50,', 'child: Align(', 'alignment: Alignment(-0.3333, -1),',
        'child: FractionallySizedBox(', 'widthFactor: 0.7,'].join('\n')), code);
});

test('a SCALE child as wide as its frame aligns at -1, and RIGHT/BOTTOM measure from the far edges', async () => {
    const code = dedent(await widgetCode(plainFrame([
        pinned('101:2', 'Full', at(0, 0, 100, 10), 'SCALE', 'TOP'),
        pinned('101:3', 'Corner', at(70, 80, 20, 10), 'RIGHT', 'BOTTOM'),
    ])));
    assert.ok(code.includes(['alignment: Alignment(-1, -1),', 'child: FractionallySizedBox(', 'widthFactor: 1,'].join('\n')), code);
    assert.ok(code.includes(['Positioned(', 'right: 10,', 'bottom: 10,', 'width: 20,', 'height: 10,'].join('\n')), code);
});

test('z-order: an absolute layer before every flow child paints behind the flow; one between flow children is named', async () => {
    const flow = (id: string) => ({id, name: 'Flow', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: at(0, 0, 40, 40), ...sized('FIXED', 'FIXED')});
    const badge = (id: string) => pinned(id, 'Badge', at(30, 0, 10, 10), 'LEFT', 'TOP', {layoutPositioning: 'ABSOLUTE'});
    const frame = (children: object[]) => ({id: '102:1', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], clipsContent: true,
        absoluteBoundingBox: at(0, 0, 80, 40), ...sized('HUG', 'HUG'), children});

    const behind = dedent(await widgetCode(frame([badge('102:2'), flow('102:3'), flow('102:4')])));
    assert.ok(behind.includes(['fit: StackFit.passthrough,', 'children: [', 'Positioned('].join('\n')), behind);
    const between = await toolText(frame([flow('102:5'), badge('102:6'), flow('102:7')]));
    assert.match(between, /\/\/ approximate: "Badge" is absolute between flow children of "Row"; it is painted in front of them/);
});

test('clipping follows clipsContent: none when off, the default hard edge when on, ClipRRect when the frame is rounded', async () => {
    const child = [pinned('103:2', 'Dot', at(0, 0, 10, 10), 'LEFT', 'TOP')];
    assert.match(await widgetCode(plainFrame(child, {clipsContent: false})), /child: Stack\(\n\s+clipBehavior: Clip\.none,/);
    assert.doesNotMatch(await widgetCode(plainFrame(child)), /clipBehavior|ClipRRect/);
    assert.match(await widgetCode(plainFrame(child, {cornerRadius: 12})), /child: ClipRRect\(\n\s+borderRadius: BorderRadius\.circular\(12\),\n\s+child: Stack\(/);
});

test('a rotated child is placed by its box and named as an approximation', async () => {
    const out = await toolText(plainFrame([pinned('104:2', 'Tilted', at(10, 10, 30, 30), 'LEFT', 'TOP', {rotation: 0.5})]));
    assert.match(out, /\/\/ approximate: "Tilted" is rotated; it is placed by its bounding box/);
});

test('a group in a frame without auto layout lends its layers to the frame: each is placed by its own constraints', async () => {
    const code = dedent(await widgetCode(plainFrame([{id: '105:2', name: 'Cluster', type: 'GROUP', absoluteBoundingBox: at(60, 60, 30, 30), children: [
        pinned('105:3', 'Inner', at(70, 70, 20, 20), 'RIGHT', 'BOTTOM'),
    ]}])));
    assert.ok(code.includes(['Positioned(', 'right: 10,', 'bottom: 10,', 'width: 20,', 'height: 20,'].join('\n')), code);
    assert.equal(code.match(/Stack\(/g)?.length, 1, code);
});

test('itemReverseZIndex swaps which absolute layers paint behind and in front of the flow', async () => {
    const flow = {id: '106:2', name: 'Flow', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: at(0, 0, 40, 40), ...sized('FIXED', 'FIXED')};
    const badge = pinned('106:3', 'Badge', at(30, 0, 10, 10), 'LEFT', 'TOP', {layoutPositioning: 'ABSOLUTE'});
    const code = dedent(await widgetCode({id: '106:1', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], clipsContent: true,
        itemReverseZIndex: true, absoluteBoundingBox: at(0, 0, 40, 40), ...sized('HUG', 'HUG'), children: [flow, badge]}));
    // Without the flag the badge (after the flow child) would paint in front; reversed, it paints behind the Row.
    assert.ok(code.includes(['fit: StackFit.passthrough,', 'children: [', 'Positioned('].join('\n')), code);
});

test('a stretch axis paired with CENTER or SCALE still stretches: an infinite box on that axis inside the Align', async () => {
    const code = dedent(await widgetCode(plainFrame([
        pinned('107:2', 'Wide', at(10, 40, 70, 20), 'LEFT_RIGHT', 'CENTER'),
        pinned('107:3', 'Tall', at(10, 10, 80, 70), 'SCALE', 'TOP_BOTTOM'),
    ])));
    assert.ok(code.includes(['Positioned(', 'left: 10,', 'right: 20,', 'top: 0,', 'bottom: 0,', 'child: Align(', 'alignment: Alignment(-1, 0),',
        'child: SizedBox(', 'width: double.infinity,', 'height: 20,'].join('\n')), code);
    assert.ok(code.includes(['child: FractionallySizedBox(', 'widthFactor: 0.8,', 'child: SizedBox(', 'height: double.infinity,'].join('\n')), code);
});

test('a CENTER child that crosses the frame edge keeps its size: no padding to squash it', async () => {
    const code = dedent(await widgetCode(plainFrame([pinned('108:2', 'Outside', at(-20, 0, 10, 10), 'CENTER', 'TOP')])));
    // s = -20 + 5 - 50 = -65
    assert.ok(code.includes(['Positioned(', 'left: -65,', 'right: 65,', 'top: 0,', 'height: 10,', 'child: Align(', 'alignment: Alignment(0, -1),',
        'child: SizedBox(', 'width: 10,'].join('\n')), code);
});

test('itemReverseZIndex reverses the whole paint order: the last absolute layer paints first', async () => {
    const flow = {id: '109:2', name: 'Flow', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: at(0, 0, 40, 40), ...sized('FIXED', 'FIXED')};
    const code = dedent(await widgetCode({id: '109:1', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], clipsContent: true,
        itemReverseZIndex: true, absoluteBoundingBox: at(0, 0, 40, 40), ...sized('HUG', 'HUG'), children: [flow,
            pinned('109:3', 'First', at(1, 0, 10, 10), 'LEFT', 'TOP', {layoutPositioning: 'ABSOLUTE'}),
            pinned('109:4', 'Second', at(2, 0, 10, 10), 'LEFT', 'TOP', {layoutPositioning: 'ABSOLUTE'})]}));
    // Figma: "the first layer will be drawn on top" — paint order Second, First, then the flow on top.
    const [second, first, flowRow] = [code.indexOf('left: 2,'), code.indexOf('left: 1,'), code.indexOf('\nRow(')];
    assert.ok(second >= 0 && second < first && first < flowRow, code);
});

test('a frame with different corner radii clips its Stack with those radii', async () => {
    const code = await widgetCode(plainFrame([pinned('110:2', 'Dot', at(0, 0, 10, 10), 'LEFT', 'TOP')], {rectangleCornerRadii: [12, 0, 12, 0]}));
    assert.match(code, /child: ClipRRect\(\n\s+borderRadius: BorderRadius\.only\(topLeft: Radius\.circular\(12\), bottomRight: Radius\.circular\(12\)\),/);
});

// Ticket 06: min/max (research 06; owner decisions 2026-10-01). A min/max "binds" when the measured size equals it.
const bar = (id: string, name: string, width: number, extra: object = {}) =>
    ({id, name, type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(width, 20), layoutGrow: 1, ...sized('FILL', 'FIXED'), ...extra});
const track = (children: object[], extra: object = {}) => ({id: '120:1', name: 'Track', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [],
    absoluteBoundingBox: box(300, 20), ...sized('FIXED', 'FIXED'), children, ...extra});

test('real fixture: a single FILL child with a max is Flexible > ConstrainedBox > infinite SizedBox (240 = Figma)', async () => {
    const code = dedent(await widgetCode(layoutCase('Layout / min-max width')));
    assert.ok(code.includes(['Flexible(', 'child: ConstrainedBox(', 'constraints: BoxConstraints(minWidth: 100, maxWidth: 240),', 'child: SizedBox(',
        'width: double.infinity,', 'child: Container(', 'height: 40,'].join('\n')), code);
    assert.doesNotMatch(code, /Expanded/);
});

test('min/max on a FIXED axis emits nothing: Figma keeps a FIXED size inside its range', async () => {
    const code = await widgetCode(track([{id: '121:2', name: 'Box', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(150, 20),
        ...sized('FIXED', 'FIXED'), minWidth: 100, maxWidth: 200}]));
    assert.doesNotMatch(code, /ConstrainedBox|BoxConstraints/);
});

test('a HUG frame with a min gets a ConstrainedBox and keeps its main-axis alignment (there is free space)', async () => {
    const code = dedent(await widgetCode(track([{id: '122:2', name: 'Pill', type: 'FRAME', layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'CENTER',
        fills: [RED], absoluteBoundingBox: box(100, 20), ...sized('HUG', 'HUG'), minWidth: 100,
        children: [{id: '122:3', name: 'Dot', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40, 20), ...sized('FIXED', 'FIXED')}]}])));
    assert.ok(code.includes(['ConstrainedBox(', 'constraints: BoxConstraints(minWidth: 100),', 'child: Container(', 'decoration: decorationID,',
        'child: Row(', 'mainAxisSize: MainAxisSize.min,', 'mainAxisAlignment: MainAxisAlignment.center,'].join('\n')), code);
});

test('a HUG frame clamped by a max narrower than its children clips them like Figma: ConstrainedBox > UnconstrainedBox(hardEdge)', async () => {
    const tight = (children: object[]) => track([{id: '123:2', name: 'Clamp', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], clipsContent: true,
        absoluteBoundingBox: box(100, 20), ...sized('HUG', 'HUG'), maxWidth: 100, children}]);
    const kid = (id: string, width: number) => ({id, name: 'Kid', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(width, 20), ...sized('FIXED', 'FIXED')});
    const clipped = dedent(await widgetCode(tight([kid('123:3', 80), kid('123:4', 80)])));
    // OverflowBoxFit (research 06's recipe) is not exported by material.dart, so generated code could not compile; an
    // UnconstrainedBox clips the same way (100 wide, children at 0, 0 errors in bounded, scroll and Row hosts).
    assert.ok(clipped.includes(['ConstrainedBox(', 'constraints: BoxConstraints(maxWidth: 100),', 'child: Container('].join('\n')), clipped);
    assert.ok(clipped.includes(['child: UnconstrainedBox(', 'constrainedAxis: Axis.vertical,', 'alignment: Alignment.topLeft,',
        'clipBehavior: Clip.hardEdge,', 'child: Row('].join('\n')), clipped);
    assert.doesNotMatch(clipped, /OverflowBox|ClipRect/);
    // Content that fits needs only the ConstrainedBox.
    const fits = await widgetCode(tight([kid('123:5', 30), kid('123:6', 30)]));
    assert.match(fits, /constraints: BoxConstraints\(maxWidth: 100\),/);
    assert.doesNotMatch(fits, /UnconstrainedBox/);
});

test('several FILL siblings: one clamped by its max keeps its Figma width (non-flex), the rest are Expanded, and it is named', async () => {
    const out = await toolText(track([bar('124:2', 'Capped', 100, {maxWidth: 100}), bar('124:3', 'Rest', 200)]));
    const code = dedent(out.slice(out.indexOf('class ')));
    assert.ok(code.includes(['children: [', 'Container(', 'width: 100,', 'height: 20,'].join('\n')), code);
    assert.equal(code.match(/Expanded\(/g)?.length, 1, code);
    assert.match(out, /\/\/ approximate: "Capped" is clamped beside other FILL siblings; it keeps its Figma width 100/);
});

test('a single FILL child with only a min stays Expanded and is named: Expanded ignores a min', async () => {
    const out = await toolText(track([bar('125:2', 'Floor', 300, {minWidth: 200})]));
    assert.match(out, /Expanded\(/);
    assert.match(out, /\/\/ approximate: "Floor" has a min width of 200; it can shrink below it when the parent is narrower/);
});

test('a cross-axis FILL child with a max: ConstrainedBox outside the infinite SizedBox', async () => {
    const code = dedent(await widgetCode({id: '126:1', name: 'Tall', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [],
        absoluteBoundingBox: box(100, 100), ...sized('FIXED', 'FIXED'),
        children: [{id: '126:2', name: 'Bar', type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(20, 40), ...sized('FIXED', 'FILL'), maxHeight: 40}]}));
    assert.ok(code.includes(['ConstrainedBox(', 'constraints: BoxConstraints(maxHeight: 40),', 'child: SizedBox(', 'height: double.infinity,'].join('\n')), code);
});

test('a FILL root with a max: LimitedBox > ConstrainedBox > infinite Container', async () => {
    const code = await widgetCode({id: '127:1', name: 'Banner', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [RED], absoluteBoundingBox: box(360, 48),
        ...sized('FILL', 'FIXED'), maxWidth: 400, children: [dot('127:2')]});
    assert.match(code, /    return LimitedBox\(\n      maxWidth: 360,\n      child: ConstrainedBox\(\n        constraints: BoxConstraints\(maxWidth: 400\),\n        child: Container\(\n          width: double\.infinity,/);
});
