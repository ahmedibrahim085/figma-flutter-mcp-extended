import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolsOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

// Reports and guidance carry no invented rules or rankings (ticket 05). Expected values are written
// here, not imported from the code.
const url = (nodeId: string) => `https://www.figma.com/design/${FILE_KEY}/x?node-id=${nodeId.replace(':', '-')}`;
const fill = {type: 'SOLID', color: {r: 0.2, g: 0.4, b: 0.6, a: 1}};
const box = (width: number, height: number, y = 0) => ({x: 0, y, width, height});
const frame = (id: string, name: string, width: number, height: number, y = 0, extra: object = {}) =>
    ({id, name, type: 'FRAME', absoluteBoundingBox: box(width, height, y), fills: [fill], ...extra});
const text = (id: string, name: string, characters?: string) => ({
    id, name, type: 'TEXT', ...(characters ? {characters} : {}), absoluteBoundingBox: box(80, 20), fills: [fill],
    style: {fontFamily: 'Inter', fontSize: 14, fontWeight: 400, letterSpacing: 0, lineHeightPx: 20, lineHeightUnit: 'PIXELS'},
});

// Wider than 400 px, spaced, mixed corner radii, a nested INSTANCE, TEXT, and children over 5000 px² (and 20000 px²).
const WIDE = {
    id: '50:1', name: 'Wide Card', type: 'FRAME', layoutMode: 'HORIZONTAL', itemSpacing: 8, fills: [fill],
    rectangleCornerRadii: [4, 8, 12, 16], absoluteBoundingBox: box(900, 300),
    children: [
        ...[1, 2, 3, 4, 5, 6].map((n) => frame(`50:${n + 1}`, `Block ${n}`, 150, 150)),
        {id: '50:8', name: 'Badge', type: 'INSTANCE', componentId: '9:9', absoluteBoundingBox: box(160, 160), fills: [fill], children: []},
        text('50:9', 'Title', 'Welcome'),
    ],
};

const BANNED = /~\d+ lines|top 15%|priority: \d+\/10|high-priority|visual weight|Consider MediaQuery|confidence scoring|Styles with relationships|No text info|NavigationRail|increasing maxChildNodes|always use (proper )?StatelessWidget|prefix with _|private widgets|functional widgets/i;

test('no tool output carries an invented rule, ranking or advice', async () => {
    const input = url(WIDE.id);
    const base = {input, nodeId: WIDE.id};
    const results = await callToolsOffline(nodeRoute(WIDE.id, WIDE), [
        ['analyze_figma_component', {...base, userDefinedComponent: true, exportAssets: false, generateFlutterCode: true}],
        ['analyze_figma_component', {...base, userDefinedComponent: true, exportAssets: false, generateFlutterCode: true, useDeduplication: false}],
        ['generate_flutter_implementation', {componentNodeId: WIDE.id}],
        ['inspect_component_structure', {...base, userDefinedComponent: true}],
        ['analyze_frame_as_screen', {...base, extractAssets: false}],
        ['inspect_frame_structure', base],
        ['cached_styles_status', {}],
    ]);

    assert.equal(results.length, 7);
    for (const {text: out} of results) {
        assert.ok(out.length > 150, `tool output too short to prove anything: ${out}`);
        assert.doesNotMatch(out, BANNED);
    }
    // Positive controls: the reports ran on this fixture, not on an error.
    assert.match(results[0].text, /Wide Card/);
    assert.match(results[4].text, /Screen Analysis Report/);
    assert.match(results[5].text, /Screen Structure Inspection/);
    assert.match(results[6].text, /Cached styles status report/);
});

test('guidance quotes Flutter instead of a line count', async () => {
    const [dedup, plain, impl, screen] = await callToolsOffline(nodeRoute(WIDE.id, WIDE), [
        ['analyze_figma_component', {input: url(WIDE.id), userDefinedComponent: true, exportAssets: false, generateFlutterCode: true}],
        ['analyze_figma_component', {input: url(WIDE.id), userDefinedComponent: true, exportAssets: false, useDeduplication: false}],
        ['generate_flutter_implementation', {componentNodeId: WIDE.id}],
        ['analyze_frame_as_screen', {input: url(WIDE.id), extractAssets: false}],
    ]);

    for (const {text: out} of [dedup, plain, impl, screen]) {
        assert.match(out, /Avoid overly large single widgets with a large build\(\) function\. Split them into different widgets based on encapsulation but also on how they change/);
        assert.match(out, /To create reusable pieces of UIs, prefer using a StatelessWidget rather than a function\./);
        assert.match(out, /docs\.flutter\.dev\/perf\/best-practices/);
    }
});

test('the report prints the corner radii Figma sends, not "mixed"', async () => {
    const [plain] = await callToolsOffline(nodeRoute(WIDE.id, WIDE), [
        ['analyze_figma_component', {input: url(WIDE.id), userDefinedComponent: true, exportAssets: false, useDeduplication: false}],
    ]);

    assert.match(plain.text, /Border radius: 4px 8px 12px 16px\n/);
    assert.match(plain.text, /First fill: /);
    assert.doesNotMatch(plain.text, /mixed|consistent|Primary|SizedBox gaps/);
});

// Figma layer order, deliberately opposite to size, type and y.
const ORDERED = {
    id: '51:1', name: 'Ordered', type: 'FRAME', layoutMode: 'VERTICAL', fills: [fill], absoluteBoundingBox: box(400, 800),
    children: [
        {id: '51:2', name: 'Dot', type: 'VECTOR', absoluteBoundingBox: box(4, 4, 500), fills: [fill]},
        frame('51:3', 'Mid', 100, 50, 200, {children: [
            {id: '51:5', name: 'Inner dot', type: 'VECTOR', absoluteBoundingBox: box(4, 4, 260), fills: [fill]},
            {id: '51:6', name: 'Inner hero', type: 'INSTANCE', componentId: '9:8', absoluteBoundingBox: box(90, 40, 200), fills: [fill], children: []},
        ]}),
        {id: '51:4', name: 'Hero', type: 'INSTANCE', componentId: '9:9', absoluteBoundingBox: box(300, 300, 0), fills: [fill], children: []},
    ],
};

test('children are numbered in Figma layer order in all four analyze and inspect reports', async () => {
    const base = {input: url(ORDERED.id), nodeId: ORDERED.id};
    const results = await callToolsOffline(nodeRoute(ORDERED.id, ORDERED), [
        ['analyze_figma_component', {...base, userDefinedComponent: true, exportAssets: false}],
        ['analyze_figma_component', {...base, userDefinedComponent: true, exportAssets: false, useDeduplication: false}],
        ['inspect_component_structure', {...base, userDefinedComponent: true}],
        ['analyze_frame_as_screen', {...base, extractAssets: false}],
        ['inspect_frame_structure', base],
    ]);

    assert.equal(results.length, 5);
    for (const {text: out} of results) {
        const order = [...out.matchAll(/^\s*\d+\. (Dot|Mid|Hero) \(/gm)].map((m) => m[1]);
        assert.deepEqual(order, ['Dot', 'Mid', 'Hero'], out);
    }
});

test('a nested component keeps its Figma type: an INSTANCE is reported as INSTANCE', async () => {
    const base = {input: url(ORDERED.id), nodeId: ORDERED.id};
    const [plain, screen] = await callToolsOffline(nodeRoute(ORDERED.id, ORDERED), [
        ['analyze_figma_component', {...base, userDefinedComponent: true, exportAssets: false, useDeduplication: false}],
        ['analyze_frame_as_screen', {...base, extractAssets: false}],
    ]);

    for (const {text: out} of [plain, screen]) {
        assert.match(out, /Type: INSTANCE/);
        assert.doesNotMatch(out, /Type: COMPONENT\n/);
    }
});
