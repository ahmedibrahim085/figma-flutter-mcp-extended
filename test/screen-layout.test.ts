import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

const BLACK = {r: 0, g: 0, b: 0, a: 1};

/** A horizontal auto-layout row whose one text child has the given horizontal sizing. */
const row = (sizing: string) => ({
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
        layoutSizingHorizontal: sizing,
        fills: [{type: 'SOLID', color: BLACK}],
        style: {fontFamily: 'Inter', fontWeight: 400, fontSize: 14, letterSpacing: 0, lineHeightPx: 18, textAlignHorizontal: 'LEFT', textAlignVertical: 'CENTER'},
    }],
});

const generateRow = (sizing: string) => callToolOffline(nodeRoute('2:1', row(sizing)), 'analyze_figma_component',
    {input: FILE_KEY, nodeId: '2:1', userDefinedComponent: true, generateFlutterCode: true});

// Upstream #35: FILL on the parent's main axis must become Expanded, not a hardcoded width.
test('a main-axis FILL child is wrapped in Expanded', async () => {
    const {text} = await generateRow('FILL');

    assert.ok(text.includes(`      child: Row(
        children: [
          Expanded(
            child: Text(
              'This label should stretch',`), text);
});

test('a HUG child is not wrapped in Expanded', async () => {
    const {text} = await generateRow('HUG');

    assert.match(text, /child: Row\(/);
    assert.doesNotMatch(text, /Expanded\(/);
});

// Upstream PR #52: sizing and parent-alignment evidence reaches both component tools.
const card = {
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
    const {text} = await callToolOffline(nodeRoute('1:1', card), 'analyze_figma_component',
        {input: FILE_KEY, nodeId: '1:1', userDefinedComponent: true});

    assert.ok(text.includes(`   • Horizontal sizing: FILL
   • Vertical sizing: HUG
   • Parent alignment: STRETCH`), text);
});

test('inspect_component_structure reports sizing and parent alignment', async () => {
    const {text} = await callToolOffline(nodeRoute('1:1', card), 'inspect_component_structure',
        {input: FILE_KEY, nodeId: '1:1', userDefinedComponent: true});

    assert.ok(text.includes(`Horizontal Sizing: FILL
Vertical Sizing: HUG
Parent Alignment: STRETCH`), text);
});

// A screen with an App Bar-like header and a body, both carrying sizing, padding, border and shadow evidence.
const screen = {
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

const analyzeScreen = (node: {id: string}) => callToolOffline(nodeRoute(node.id, node), 'analyze_full_screen',
    {input: FILE_KEY, nodeId: node.id, extractAssets: false});

test('analyze_full_screen reports each section with sizing, border and shadow', async () => {
    const {text, requests} = await analyzeScreen(screen);

    assert.deepEqual(requests.map((r) => ({path: r.path, query: r.query})),
        [{path: `/files/${FILE_KEY}/nodes`, query: {ids: '4:1'}}]);
    assert.ok(text.includes(`Screen Sections (2 identified):
1. Header (HEADER)
   Priority: 8/10
   Size: 375×56px
   Horizontal Sizing: FILL
   Vertical Sizing: FIXED
   Parent Alignment: STRETCH
   - Border: 1px solid #000000 align INSIDE
   - Drop shadow 1: #000000 opacity 5% offset(0, 3) blur 100px
   Contains: 1 elements
   - Title: 200×24px
2. Body Content (CONTENT)
   Priority: 8/10
   Size: 375×700px
   Horizontal Sizing: FILL
   Vertical Sizing: FILL
   Parent Alignment: STRETCH
   Contains: 1 elements
   - Text: 300×20px
`), text);
});

test('inspect_screen_structure reports padding, border and shadow per section', async () => {
    const {text} = await callToolOffline(nodeRoute('4:1', screen), 'inspect_screen_structure',
        {input: FILE_KEY, nodeId: '4:1', showAllSections: true});

    assert.ok(text.includes(`Screen Structure:
1. Header (FRAME) [HEADER]
   Size: 375×56px
   Position: (0, 0)
   Horizontal Sizing: FILL
   Vertical Sizing: FIXED
   Parent Alignment: STRETCH
   Contains: 1 child elements
   - Padding: 8px 16px 8px 16px (TRBL)
   - Border: 1px solid #000000 align INSIDE
   - Drop shadow 1: #000000 opacity 5% offset(0, 3) blur 100px
2. Body Content (FRAME)
   Size: 375×700px
   Position: (0, 56)
   Horizontal Sizing: FILL
   Vertical Sizing: FILL
   Parent Alignment: STRETCH
   Contains: 1 child elements
`), text);
});

// Upstream PR #53: SafeArea keeps the top edge only when no App Bar occupies it.
test('with an App Bar header, the SafeArea leaves the top edge to it', async () => {
    const {text} = await analyzeScreen(screen);

    assert.ok(text.includes(`  body: SafeArea(
    top: false, // the App Bar already occupies the top edge
    child: Column(`), text);
});

test('without an App Bar, the top safe area is required and SafeArea keeps the top edge', async () => {
    const {text} = await analyzeScreen({
        id: '1:2',
        name: 'Screen',
        type: 'FRAME',
        absoluteBoundingBox: {x: 0, y: 0, width: 375, height: 812},
        children: [{id: '1:3', name: 'Body Content', type: 'FRAME', absoluteBoundingBox: {x: 0, y: 0, width: 375, height: 700}}],
    });

    assert.match(text, /^- Top Safe Area: Required at runtime \(no App Bar present\)$/m);
    assert.ok(text.includes(`Scaffold(
  body: SafeArea(
    child: Column(`), text);
});
