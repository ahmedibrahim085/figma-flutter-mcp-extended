import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

const BLACK = {r: 0, g: 0, b: 0, a: 1};

type Sizing = 'FILL' | 'HUG' | 'FIXED';

/** Calls `tool` on `node`, served by the fake under its own id. */
const callOnNode = (node: {id: string}, tool: string, args: Record<string, unknown> = {}) =>
    callToolOffline(nodeRoute(node.id, node), tool, {input: FILE_KEY, nodeId: node.id, ...args});

/** A horizontal auto-layout row with one text child sized as given on each axis. */
const listRow = (horizontal: Sizing, vertical: Sizing = 'HUG') => ({
    id: '2:1',
    name: 'List Row',
    type: 'FRAME',
    layoutMode: 'HORIZONTAL',
    itemSpacing: 12,
    children: [{
        id: '2:2',
        name: 'Label',
        type: 'TEXT',
        characters: 'This label should stretch',
        layoutSizingHorizontal: horizontal,
        layoutSizingVertical: vertical,
        fills: [{type: 'SOLID', color: BLACK}],
        style: {fontFamily: 'Inter', fontWeight: 400, fontSize: 14, letterSpacing: 0, lineHeightPx: 18, textAlignHorizontal: 'LEFT', textAlignVertical: 'CENTER'},
    }],
});

/** Flutter code for the row, through the default (deduplicated) path. */
const generateRow = (horizontal: Sizing, vertical?: Sizing) =>
    callOnNode(listRow(horizontal, vertical), 'analyze_figma_component', {userDefinedComponent: true, generateFlutterCode: true});

// Upstream #35: FILL on the parent's main axis must become Expanded, not a hardcoded width.
test('a main-axis FILL child is wrapped in Expanded', async () => {
    const {text} = await generateRow('FILL');

    assert.ok(text.includes(`      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              'This label should stretch',`), text);
});

for (const [label, horizontal, vertical] of [
    ['a HUG child', 'HUG', 'HUG'],
    ['a cross-axis FILL child', 'HUG', 'FILL'],
] as const) {
    test(`${label} is not wrapped in Expanded`, async () => {
        const {text} = await generateRow(horizontal, vertical);

        assert.match(text, /child: Row\(/);
        assert.doesNotMatch(text, /Expanded\(/);
    });
}

// Upstream PR #52 through the deduplicated analysis (component-codegen.test.ts covers
// inspect_component_structure). The spot check's layoutGrow and primary/counter axis
// alignment are not reported by either tool for this node, so only reported evidence is pinned.
const CARD = {
    id: '1:1',
    name: 'Card',
    type: 'FRAME',
    layoutMode: 'HORIZONTAL',
    layoutSizingHorizontal: 'FILL',
    layoutSizingVertical: 'HUG',
    layoutAlign: 'STRETCH',
    layoutGrow: 1,
    absoluteBoundingBox: {x: 0, y: 0, width: 300, height: 80},
    children: [],
};

test('analyze_figma_component reports sizing and parent alignment', async () => {
    const {text} = await callOnNode(CARD, 'analyze_figma_component', {userDefinedComponent: true});

    assert.ok(text.includes(`   • Horizontal sizing: FILL
   • Vertical sizing: HUG
   • Parent alignment: STRETCH`), text);
});

// A screen with an App Bar-like header and a body, both carrying sizing, padding, border and shadow evidence.
const SCREEN = {
    id: '4:1',
    name: 'Screen',
    type: 'FRAME',
    absoluteBoundingBox: {x: 0, y: 0, width: 375, height: 812},
    layoutSizingHorizontal: 'FIXED',
    layoutSizingVertical: 'FIXED',
    layoutAlign: 'STRETCH',
    children: [
        {
            id: '4:2',
            name: 'Header',
            type: 'FRAME',
            absoluteBoundingBox: {x: 0, y: 0, width: 375, height: 56},
            layoutSizingHorizontal: 'FILL',
            layoutSizingVertical: 'FIXED',
            layoutAlign: 'STRETCH',
            paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16,
            strokes: [{type: 'SOLID', color: BLACK, strokeWeight: 1}],
            strokeAlign: 'INSIDE',
            effects: [{type: 'DROP_SHADOW', visible: true, color: {...BLACK, a: 0.05}, offset: {x: 0, y: 3}, radius: 100}],
            children: [{id: '4:4', name: 'Title', type: 'TEXT', characters: 'Screen Title', absoluteBoundingBox: {x: 16, y: 16, width: 200, height: 24}}],
        },
        {
            id: '4:3',
            name: 'Body Content',
            type: 'FRAME',
            absoluteBoundingBox: {x: 0, y: 56, width: 375, height: 700},
            layoutSizingHorizontal: 'FILL',
            layoutSizingVertical: 'FILL',
            layoutAlign: 'STRETCH',
            children: [{id: '4:5', name: 'Text', type: 'TEXT', characters: 'Body text here', absoluteBoundingBox: {x: 16, y: 72, width: 300, height: 20}}],
        },
    ],
};

const analyzeScreen = (node: {id: string}) => callOnNode(node, 'analyze_frame_as_screen', {extractAssets: false});

test('analyze_frame_as_screen reports each child layer in layer order with sizing, border and shadow', async () => {
    const {text, requests} = await analyzeScreen(SCREEN);

    assert.deepEqual(requests.map((r) => ({path: r.path, query: r.query})),
        [{path: `/files/${FILE_KEY}/nodes`, query: {ids: '4:1'}}]);
    assert.ok(text.includes(`Child layers (2 identified):
1. Header (FRAME, 4:2)
   Size: 375×56px
   Position: (0, 0) in parent
   Horizontal Sizing: FILL
   Vertical Sizing: FIXED
   Parent Alignment: STRETCH
   - Border: 1px solid #000000 align INSIDE
   - Drop shadow 1: #000000 opacity 5% offset(0, 3) blur 100px
   Contains: 1 elements
   - Title: 200×24px
2. Body Content (FRAME, 4:3)
   Size: 375×700px
   Position: (0, 56) in parent
   Horizontal Sizing: FILL
   Vertical Sizing: FILL
   Parent Alignment: STRETCH
   Contains: 1 elements
   - Text: 300×20px
`), text);
});

test('inspect_frame_structure reports padding, border and shadow per child layer', async () => {
    const {text} = await callOnNode(SCREEN, 'inspect_frame_structure', {showAllChildren: true});

    assert.ok(text.includes(`Screen Structure:
1. Header (FRAME, 4:2)
   Size: 375×56px
   Position: (0, 0) in parent
   Horizontal Sizing: FILL
   Vertical Sizing: FIXED
   Parent Alignment: STRETCH
   Contains: 1 child layers
   - Padding: 8px 16px 8px 16px (TRBL)
   - Border: 1px solid #000000 align INSIDE
   - Drop shadow 1: #000000 opacity 5% offset(0, 3) blur 100px
2. Body Content (FRAME, 4:3)
   Size: 375×700px
   Position: (0, 56) in parent
   Horizontal Sizing: FILL
   Vertical Sizing: FILL
   Parent Alignment: STRETCH
   Contains: 1 child layers
`), text);
});

// Ticket 04: layers are listed in Figma order with parent-relative bounds; no role is guessed from a name or a position.
const frame = (id: string, name: string, x: number, y: number, width: number, height: number, extra: object = {}) =>
    ({id, name, type: 'FRAME', absoluteBoundingBox: {x, y, width, height}, ...extra});
const screenOf = (children: object[], y = 0) => ({
    id: '6:1', name: 'Home', type: 'FRAME', absoluteBoundingBox: {x: 0, y, width: 375, height: 812}, children,
});
const BOTH_TOOLS = [['analyze_frame_as_screen', {extractAssets: false}], ['inspect_frame_structure', {}]] as const;

const moveDown = (node: any, dy: number): any => ({
    ...node,
    ...(node.absoluteBoundingBox ? {absoluteBoundingBox: {...node.absoluteBoundingBox, y: node.absoluteBoundingBox.y + dy}} : {}),
    ...(node.children ? {children: node.children.map((child: any) => moveDown(child, dy))} : {}),
});

for (const [tool, args] of BOTH_TOOLS) {
    test(`${tool}: the same screen moved 5000 px down gives identical output`, async () => {
        const at = await callOnNode(SCREEN, tool, args);
        const moved = await callOnNode(moveDown(SCREEN, 5000), tool, args);

        for (const result of [at, moved]) {
            assert.equal(result.isError, false, result.text);
            assert.match(result.text, /^Screen (Analysis Report|Structure Inspection)\n/);
        }
        assert.equal(moved.text, at.text);
    });

    test(`${tool}: a child's position is relative to its parent`, async () => {
        const node = screenOf([frame('6:2', 'Card', 150, 300, 100, 50)], 200);
        node.absoluteBoundingBox.x = 50;
        const {text} = await callOnNode(node, tool, args);

        assert.match(text, /Card \(FRAME, 6:2\)[^]*?Position: \(100, 100\) in parent/);
    });

    test(`${tool}: a 40×40 "Back button" and a frame named "Nav Bar" are listed, not dropped`, async () => {
        const node = screenOf([frame('6:2', 'Back button', 8, 8, 40, 40), frame('6:3', 'Nav Bar', 0, 0, 375, 44)]);
        const {text} = await callOnNode(node, tool, args);

        assert.match(text, /1\. Back button \(FRAME, 6:2\)/);
        assert.match(text, /2\. Nav Bar \(FRAME, 6:3\)/);
        assert.doesNotMatch(text, /filtered|device UI/i);
    });

    test(`${tool}: children are listed in layer order, not sorted by size`, async () => {
        const node = screenOf([frame('6:2', 'B', 0, 600, 20, 20), frame('6:3', 'Header', 0, 0, 375, 300)]);
        const {text} = await callOnNode(node, tool, args);

        assert.match(text, /1\. B \(FRAME, 6:2\)/);
        assert.match(text, /2\. Header \(FRAME, 6:3\)/);
        assert.doesNotMatch(text, /Priority|\[HEADER\]|\(HEADER\)/);
    });

    test(`${tool}: a layer with scrollBehavior FIXED is listed as a child and again under "Fixed on scroll"`, async () => {
        const node = screenOf([
            frame('6:2', 'Status Bar', 0, 0, 375, 44, {scrollBehavior: 'FIXED'}),
            frame('6:3', 'Body', 0, 44, 375, 700, {scrollBehavior: 'SCROLLS'}),
            frame('6:4', 'Menu', 0, 744, 375, 68, {scrollBehavior: 'FIXED'}),
        ]);
        const {text} = await callOnNode(node, tool, args);

        assert.match(text, /1\. Status Bar \(FRAME, 6:2\)/);
        assert.match(text, /3\. Menu \(FRAME, 6:4\)/);
        assert.match(text, /Fixed on scroll \(Figma scrollBehavior: FIXED\):\n- Status Bar \(FRAME, 6:2\)\n- Menu \(FRAME, 6:4\)\n/);
    });

    test(`${tool}: no "Fixed on scroll" heading when no layer is FIXED`, async () => {
        const {text} = await callOnNode(SCREEN, tool, args);

        assert.doesNotMatch(text, /Fixed on scroll/);
    });
}

test('analyze_frame_as_screen: a nested text named "Section Header" gives no appBar', async () => {
    const node = screenOf([{...frame('6:2', 'Card list', 0, 0, 375, 400), children: [
        {id: '6:3', name: 'Section Header', type: 'TEXT', characters: 'Section Header', absoluteBoundingBox: {x: 0, y: 0, width: 100, height: 20}},
    ]}]);
    const {text} = await analyzeScreen(node);

    assert.doesNotMatch(text, /appBar:/);
});

test('analyze_frame_as_screen: the scaffold is always Scaffold(body: SafeArea(Column(children in order)))', async () => {
    const node = screenOf([
        frame('6:2', 'Header', 0, 0, 375, 56), frame('6:3', 'Tab bar', 0, 756, 375, 56), frame('6:4', 'Drawer', 0, 100, 200, 400),
    ]);
    const {text} = await analyzeScreen(node);

    assert.ok(text.includes(`Scaffold(
  body: SafeArea(
    child: Column(
      children: [
        Header(),
        TabBar(),
        Drawer(),
      ],
    ),
  ),
)`), text);
    assert.doesNotMatch(text, /top: false|bottom: false|appBar:|drawer:|bottomNavigationBar:|Top Safe Area|Has (Header|Footer|Navigation)/);
});

test('analyze_frame_as_screen: a layer named "Login" or "Next" yields no button or tab widget guidance', async () => {
    const node = screenOf([frame('6:2', 'Login button', 0, 0, 100, 40), frame('6:3', 'Tab Home', 0, 50, 100, 40)]);
    const {text} = await analyzeScreen(node);

    assert.doesNotMatch(text, /ElevatedButton|TextButton|BottomNavigationBar|Icons\.(placeholder|home)|Navigation Items|extractNavigation/);
});

test('analyze_frame_as_screen: scaffold and child widget names are valid, distinct Dart class names', async () => {
    const node = screenOf([frame('6:2', '2FA code', 0, 0, 100, 40), frame('6:3', 'Card', 0, 50, 100, 40), frame('6:4', 'Card', 0, 100, 100, 40), frame('6:5', 'Card2', 0, 150, 100, 40)]);
    const {text} = await analyzeScreen(node);

    const scaffold = [...text.matchAll(/^ {8}(\w+)\(\),$/gm)].map((m) => m[1]);
    const listed = [...text.matchAll(/^\d+\. (\w+)\(\)$/gm)].map((m) => m[1]);
    assert.equal(scaffold.length, 4, text);
    for (const name of scaffold) assert.match(`${name}()`, /^[A-Za-z][A-Za-z0-9]*\(\)/);
    assert.equal(new Set(scaffold).size, 4, scaffold.join());
    assert.deepEqual(listed, scaffold);
});

test('analyze_frame_as_screen: child widget names keep the word boundaries typeName keeps, as the component tools do', async () => {
    const node = screenOf([frame('6:2', 'myHTTPClient', 0, 0, 100, 40), frame('6:3', 'iOS Status-Bar', 0, 50, 100, 40), frame('6:4', 'Tab bar', 0, 100, 100, 40)]);
    const {text} = await analyzeScreen(node);

    const scaffold = [...text.matchAll(/^ {8}(\w+)\(\),$/gm)].map((m) => m[1]);
    assert.deepEqual(scaffold, ['MyHTTPClient', 'IOSStatusBar', 'TabBar'], text);
});
