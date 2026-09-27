import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {callToolOffline, nodeRoute, normalizeStyleIds, FILE_KEY} from './helpers/offline-tool.ts';

const BUTTON_SET_FIXTURE = new URL('./fixtures/component-button-set.json', import.meta.url);

const analyze = (routes: Parameters<typeof callToolOffline>[0], nodeId: string) =>
    callToolOffline(routes, 'analyze_figma_component', {
        input: FILE_KEY,
        nodeId,
        exportAssets: false,
        generateFlutterCode: true,
        userDefinedComponent: true,
    });

const solid = (r: number, g: number, b: number) => ({type: 'SOLID', color: {r, g, b, a: 1}});
const linear = (from: [number, number, number], to: [number, number, number]) => ({
    type: 'GRADIENT_LINEAR',
    gradientHandlePositions: [{x: 0, y: 0.5}, {x: 1, y: 0.5}, {x: 0, y: 1}],
    gradientStops: [
        {position: 0, color: {r: from[0], g: from[1], b: from[2], a: 1}},
        {position: 1, color: {r: to[0], g: to[1], b: to[2], a: 1}},
    ],
});
const text = (id: string, characters: string, fontSize: number, fontWeight: number) => ({
    id, name: characters, type: 'TEXT', characters,
    fills: [solid(0, 0, 0)],
    style: {fontFamily: 'Inter', fontWeight, fontSize},
});
const frame = (id: string, fills: object[], children: object[] = []) => ({
    id, name: `Frame ${id}`, type: 'FRAME', layoutMode: 'VERTICAL',
    absoluteBoundingBox: {x: 0, y: 0, width: 100, height: 40}, fills, children,
});
/** The TextStyle generated for the Text widget whose string is `label`. */
const textStyleOf = (code: string, label: string) =>
    code.match(new RegExp(`'${label}',\\s*style: (TextStyle\\([^\\n]*\\))`))?.[1];

test('committed Figma fixture carries no file key, thumbnail URL or account data', () => {
    const raw = readFileSync(BUTTON_SET_FIXTURE, 'utf-8');
    assert.deepEqual(Object.keys(JSON.parse(raw)), ['nodes']);
    for (const forbidden of [/thumbnail/i, /https?:\/\//, /lastModified/, /linkAccess/, /"role"/, /[\w.+-]+@[\w-]+\.[\w.]+/]) {
        assert.doesNotMatch(raw, forbidden);
    }
});

test('analyze_figma_component on the real Button fixture reports its structure and styles', async () => {
    const fixture = JSON.parse(readFileSync(BUTTON_SET_FIXTURE, 'utf-8'));
    const {text: report, requests} = await analyze({[`/files/${FILE_KEY}/nodes?ids=1:64`]: {body: fixture}}, '1:64');
    const out = normalizeStyleIds(report);

    assert.equal(requests.length, 1);
    assert.match(out, /Name: Fixture \/ Components/);
    assert.match(out, /Children Analysis \(3 children\)/);
    assert.match(out, /1\. Icons \(FRAME\)/);
    assert.match(out, /2\. Button \(COMPONENT_SET\)/);
    assert.match(out, /3\. Button instances \(FRAME\)/);
    assert.match(out, /Node ID: 1:86\n\s+🔧 Needs separate analysis: Yes/);
    assert.match(out, /• decoration: 2 style\(s\)\n\s+• padding: 1 style\(s\)/);
    assert.match(out, /class FixtureComponents extends StatelessWidget/);
});

test('auto-layout card reports sizing, alignment, padding and its text style', async () => {
    const card = {
        id: '5:1', name: 'Card', type: 'FRAME', layoutMode: 'HORIZONTAL',
        layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', layoutAlign: 'STRETCH',
        itemSpacing: 8, paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 16,
        fills: [solid(1, 1, 1)],
        children: [{
            ...text('5:2', 'Card label', 14, 500),
            layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', layoutAlign: 'STRETCH',
        }],
    };
    const {text: report} = await analyze(nodeRoute('5:1', card), '5:1');
    const out = normalizeStyleIds(report);
    assert.match(out, /Name: Card\n\s+• Type: FRAME/);
    assert.match(out, /Horizontal sizing: FILL\n\s+• Vertical sizing: HUG\n\s+• Parent alignment: STRETCH/);
    assert.match(out, /1\. Card label \(TEXT\) \[TEXT\]\n\s+📝 Text: "Card label"/);
    assert.match(out, /• decoration: 2 style\(s\)\n\s+• padding: 1 style\(s\)\n\s+• text: 1 style\(s\)/);
    assert.match(textStyleOf(report, 'Card label') ?? '', /fontSize: 14, fontWeight: FontWeight\.w500/);
});

test('each text keeps its own TextStyle (a later text never reuses the first one)', async () => {
    const {text: code} = await analyze(nodeRoute('9:1', frame('9:1', [solid(1, 0, 0)], [
        text('9:2', 'Title', 32, 700),
        text('9:3', 'Body', 14, 400),
    ])), '9:1');
    assert.equal(textStyleOf(code, 'Title'), "TextStyle(fontFamily: 'Inter', fontSize: 32, fontWeight: FontWeight.bold, color: Color(0xFF000000))");
    assert.equal(textStyleOf(code, 'Body'), "TextStyle(fontFamily: 'Inter', fontSize: 14, color: Color(0xFF000000))");
});

test('text under a gradient parent keeps its TextStyle', async () => {
    const {text: code} = await analyze(nodeRoute('9:1', frame('9:1', [linear([1, 0, 0], [0, 0, 1])], [
        text('9:2', 'Hello', 32, 700),
    ])), '9:1');
    assert.equal(textStyleOf(code, 'Hello'), "TextStyle(fontFamily: 'Inter', fontSize: 32, fontWeight: FontWeight.bold, color: Color(0xFF000000))");
});

test('different gradients get different decoration styles; identical ones share one', async () => {
    const redToBlue = linear([1, 0, 0], [0, 0, 1]);
    const greenToBlack = linear([0, 1, 0], [0, 0, 0]);
    const {text: report} = await analyze(nodeRoute('9:1', frame('9:1', [], [
        frame('9:2', [redToBlue]),
        frame('9:3', [greenToBlack]),
        frame('9:4', [redToBlue]),
    ])), '9:1');
    const refs = [...normalizeStyleIds(report).matchAll(/^\s+\d\. Frame 9:\d \(FRAME\)[\s\S]*?Style refs: (\S+)/gm)]
        .map((match) => match[1]);
    const rawRefs = [...report.matchAll(/^\s+\d\. Frame 9:\d \(FRAME\)[\s\S]*?Style refs: (\S+)/gm)].map((match) => match[1]);
    assert.equal(refs.length, 3, `expected 3 child decorations, got ${JSON.stringify(rawRefs)}`);
    assert.equal(rawRefs[0], rawRefs[2], 'identical gradients must share one style');
    assert.notEqual(rawRefs[0], rawRefs[1], 'different gradients must not share a style');
});
