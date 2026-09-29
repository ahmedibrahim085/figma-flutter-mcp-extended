// Known codegen defects, pinned as they are today. Each test asserts current
// (wrong) output and names the slice that replaces it; the commit that fixes a
// defect rewrites its pin to the correct output. Do not read these as desired behaviour.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, callToolsOffline, nodeRoute, normalizeStyleIds, FILE_KEY} from './helpers/offline-tool.ts';

const color = (r: number, g: number, b: number) => ({r, g, b, a: 1});
const BLACK_FILL = {type: 'SOLID', color: color(0, 0, 0)};
const textNode = (id: string, characters: string, style: object, extra: object = {}) =>
    ({id, name: characters, type: 'TEXT', characters, fills: [BLACK_FILL], style, ...extra});
const box = (id: string, name: string, fills: object[], extra: object = {}) =>
    ({id, name, type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: {x: 0, y: 0, width: 200, height: 100}, fills, children: [], ...extra});

/** Generated widget code from analyze_figma_component, with style ids normalised. */
async function widgetCode(node: {id: string}): Promise<string> {
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component',
        {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true});
    const start = text.indexOf('class ');
    assert.ok(start >= 0, `no generated class in:\n${text}`);
    return normalizeStyleIds(text.slice(start));
}

/** Style definitions printed by generate_flutter_implementation after analysing `node` in the same server. */
async function styleDefinitions(node: {id: string}): Promise<string> {
    const [, generated] = await callToolsOffline(nodeRoute(node.id, node), [
        ['analyze_figma_component', {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true}],
        ['generate_flutter_implementation', {componentNodeId: node.id}],
    ]);
    return normalizeStyleIds(generated.text);
}

const STYLED_HEADING = {
    id: '11:1', name: 'Text Frame', type: 'FRAME', layoutMode: 'VERTICAL', fills: [],
    children: [textNode('11:2', 'Heading', {
        fontFamily: 'Inter', fontWeight: 600, fontSize: 16, lineHeightPx: 24, lineHeightUnit: 'PIXELS',
        letterSpacing: 0.5, textCase: 'UPPER', textDecoration: 'UNDERLINE', italic: true, textAlignHorizontal: 'CENTER',
    })],
};

test('TextStyle carries every Figma text style field', async () => {
    const code = await widgetCode(STYLED_HEADING);

    // 24 px line height on 16 px text is height 1.5.
    assert.ok(code.includes("style: TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w600, fontStyle: FontStyle.italic, "
        + "color: Color(0xFF000000), letterSpacing: 0.5, height: 1.5, leadingDistribution: TextLeadingDistribution.even, decoration: TextDecoration.underline),"), code);
});

test('upper case is baked into the string and centring goes on the Text widget', async () => {
    const code = await widgetCode(STYLED_HEADING);

    assert.ok(code.includes("            'HEADING',\n            style: TextStyle("), code);
    assert.match(code, /\n            textAlign: TextAlign\.center,\n          \),/);
});

test('auto-layout Row has no alignment, spacing or fixed size (pins current behaviour, slice 2 replaces this)', async () => {
    const code = await widgetCode({
        id: '12:1', name: 'Toolbar', type: 'FRAME', layoutMode: 'HORIZONTAL', itemSpacing: 12,
        primaryAxisAlignItems: 'SPACE_BETWEEN', counterAxisAlignItems: 'CENTER', paddingLeft: 16, paddingRight: 16,
        layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', absoluteBoundingBox: {x: 0, y: 0, width: 320, height: 48}, fills: [],
        children: [textNode('12:2', 'Left', {fontFamily: 'Inter', fontWeight: 400, fontSize: 14}), textNode('12:3', 'Right', {fontFamily: 'Inter', fontWeight: 400, fontSize: 14})],
    });

    // SPACE_BETWEEN, CENTER, itemSpacing 12 and the fixed 320×48 size are all dropped:
    // no alignment, no size, and the two Texts sit next to each other with no gap.
    assert.ok(code.includes(`    return Container(
      padding: paddingID,
      child: Row(
        children: [
          Text(
            'Left',
            style: TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w400, color: Color(0xFF000000), letterSpacing: 0),
          ),
          Text(
            'Right',`), code);
});

const GRADIENT_FILL = {
    type: 'GRADIENT_LINEAR',
    gradientHandlePositions: [{x: 0, y: 0.5}, {x: 1, y: 0.5}, {x: 0, y: 1}],
    gradientStops: [{position: 0, color: color(1, 0, 0)}, {position: 1, color: color(0, 0, 1)}],
};

for (const [fill, slice, node] of [
    ['a gradient', 3, box('13:1', 'Gradient Card', [GRADIENT_FILL])],
    ['an image', 7, box('17:1', 'Photo Card', [{type: 'IMAGE', imageRef: 'abc123', scaleMode: 'FILL'}])],
] as const) {
    test(`${fill} fill becomes an empty BoxDecoration (pins current behaviour, slice ${slice} replaces this)`, async () => {
        const definitions = await styleDefinitions(node);

        assert.ok(definitions.includes('final decorationID = BoxDecoration(\n);\n'), definitions);
    });
}

test('component properties give no widget parameters and a nested ElevatedButton (pins current behaviour, slice 6 replaces this)', async () => {
    const code = await widgetCode({
        id: '16:1', name: 'Primary Button', type: 'COMPONENT', layoutMode: 'HORIZONTAL', paddingLeft: 16, paddingRight: 16,
        cornerRadius: 8, fills: [{type: 'SOLID', color: color(0, 0.4, 1)}],
        componentPropertyDefinitions: {'Label#1:0': {type: 'TEXT', defaultValue: 'Submit'}, 'Disabled#1:1': {type: 'BOOLEAN', defaultValue: false}},
        children: [textNode('16:2', 'Submit', {fontFamily: 'Inter', fontWeight: 500, fontSize: 14}, {componentPropertyReferences: {characters: 'Label#1:0'}})],
    });

    // Label and Disabled are not constructor parameters; the button's own label is wrapped in another ElevatedButton.
    assert.ok(code.includes('const PrimaryButton({Key? key}) : super(key: key);'), code);
    assert.ok(code.includes(`          ElevatedButton(
            onPressed: () {},
            child: Text('Submit'),
          ),`), code);
});

test('a fill bound to a variable becomes a literal colour (pins current behaviour, slice 5 replaces this)', async () => {
    const definitions = await styleDefinitions(box('15:1', 'Brand Surface',
        [{type: 'SOLID', color: color(0, 0.4, 1), boundVariables: {color: {type: 'VARIABLE_ALIAS', id: 'VariableID:1:2'}}}],
        {boundVariables: {fills: [{type: 'VARIABLE_ALIAS', id: 'VariableID:1:2'}]}}));

    assert.ok(definitions.includes('final decorationID = BoxDecoration(\n  color: Color(0xFF0066FF),\n);\n'), definitions);
});
