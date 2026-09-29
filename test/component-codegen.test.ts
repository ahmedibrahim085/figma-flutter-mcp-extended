import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {callToolOffline, nodeRoute, normalizeStyleIds, FILE_KEY} from './helpers/offline-tool.ts';
import {withServer} from './helpers/mcp-stdio.ts';
import {startFakeFigma, type FakeResponse} from './helpers/fake-figma.ts';

const BUTTON_SET_FIXTURE = new URL('./fixtures/component-button-set.json', import.meta.url);

/** Calls analyze_figma_component once and checks it asked Figma for exactly that node. */
async function analyze(routes: Record<string, FakeResponse>, nodeId: string, extra: object = {}) {
    const result = await callToolOffline(routes, 'analyze_figma_component', {
        input: FILE_KEY,
        nodeId,
        exportAssets: false,
        generateFlutterCode: true,
        userDefinedComponent: true,
        ...extra,
    });
    assert.deepEqual(
        result.requests.map((r) => ({path: r.path, query: r.query})),
        [{path: `/files/${FILE_KEY}/nodes`, query: {ids: nodeId}}],
    );
    return result.text;
}

type Rgb = [number, number, number];
const color = ([r, g, b]: Rgb, a = 1) => ({r, g, b, a});
const solid = (rgb: Rgb, opacity?: number) => ({type: 'SOLID', color: color(rgb), ...(opacity === undefined ? {} : {opacity})});
const linear = (from: Rgb, to: Rgb) => ({
    type: 'GRADIENT_LINEAR',
    gradientHandlePositions: [{x: 0, y: 0.5}, {x: 1, y: 0.5}, {x: 0, y: 1}],
    gradientStops: [{position: 0, color: color(from)}, {position: 1, color: color(to)}],
});
const shadow = (type: 'DROP_SHADOW' | 'INNER_SHADOW', radius: number, visible = true) => ({
    type, visible, radius, color: color([0, 0, 0], 0.25), offset: {x: 0, y: 2}, spread: 0,
});
const textNode = (id: string, characters: string, fontSize: number, fontWeight: number, fills: object[] = [solid([0, 0, 0])]) => ({
    id, name: characters, type: 'TEXT', characters, fills,
    style: {fontFamily: 'Inter', fontWeight, fontSize},
});
const frame = (id: string, fills: object[], children: object[] = [], extra: object = {}) => ({
    id, name: `Frame ${id}`, type: 'FRAME', layoutMode: 'VERTICAL',
    absoluteBoundingBox: {x: 0, y: 0, width: 100, height: 40}, fills, children, ...extra,
});
/** The TextStyle generated for the Text widget whose string is `label`. */
const textStyleOf = (code: string, label: string) =>
    code.match(new RegExp(`'${label}',\\s*style: (TextStyle\\([^\\n]*\\))`))?.[1];
/** Style refs listed for the child named `name` in the children analysis. */
const refsOf = (report: string, name: string) =>
    report.match(new RegExp(`\\d\\. ${name} \\([A-Z_]+\\)[^]*?Style refs: ([^\\n]+)`))?.[1].split(', ') ?? [];

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url);

test('every committed Figma fixture is node data only: no file metadata, keys, URLs or account data', () => {
    const files = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.json'));
    assert.ok(files.includes('component-button-set.json'), 'the fixture directory must be the one the tests read');
    for (const file of files) {
        const raw = readFileSync(new URL(file, FIXTURES_DIR), 'utf-8');
        const json = JSON.parse(raw);
        assert.deepEqual(Object.keys(json), ['nodes'], file);
        for (const forbidden of [/thumbnail/i, /https?:\/\//, /lastModified/, /linkAccess/, /"role"/, /"key"/, /[\w.+-]+@[\w-]+\.[\w.]+/]) {
            assert.doesNotMatch(raw, forbidden, file);
        }
        // Figma file keys are 22 base62 characters; component publish keys are 40 hex characters.
        const strings: string[] = [];
        const walk = (value: unknown): void => {
            if (typeof value === 'string') strings.push(value);
            else if (value && typeof value === 'object') Object.values(value).forEach(walk);
        };
        walk(json);
        assert.deepEqual(strings.filter((s) => /^[A-Za-z0-9]{22}$/.test(s) || /^[0-9a-f]{40}$/.test(s)), [], file);
    }
});

test('analyze_figma_component on the real Button fixture reports its structure and styles, stable across runs', async () => {
    const fixture = JSON.parse(readFileSync(BUTTON_SET_FIXTURE, 'utf-8'));
    const routes = {[`/files/${FILE_KEY}/nodes?ids=1:64`]: {body: fixture}};
    const first = normalizeStyleIds(await analyze(routes, '1:64'));
    const second = normalizeStyleIds(await analyze(routes, '1:64'));

    assert.equal(first, second, 'normalised output must be identical across runs');
    assert.match(first, /Name: Fixture \/ Components/);
    assert.match(first, /Children Analysis \(3 children\)/);
    assert.match(first, /1\. Icons \(FRAME\)/);
    assert.match(first, /2\. Button \(COMPONENT_SET\)/);
    assert.match(first, /3\. Button instances \(FRAME\)/);
    assert.match(first, /Node ID: 1:86\n\s+🔧 Needs separate analysis: Yes/);
    assert.match(first, /• decoration: 2 style\(s\)\n\s+• padding: 1 style\(s\)/);
    assert.match(first, /class FixtureComponents extends StatelessWidget/);
});

// Converted from the component regression repro: HORIZONTAL auto-layout with
// padding, stroke + align, radius, FILL/HUG sizing and alignment on the
// component and a child, through the non-deduplicated report and the
// structure inspection.
const CARD_ROW = {
    id: '3:1', name: 'Card Row', type: 'COMPONENT', layoutMode: 'HORIZONTAL', itemSpacing: 8,
    paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 16,
    primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'MAX',
    layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', layoutAlign: 'STRETCH',
    fills: [solid([0.95, 0.95, 0.95])],
    strokes: [{type: 'SOLID', color: color([0.2, 0.2, 0.2]), strokeWeight: 2}], strokeAlign: 'INSIDE',
    cornerRadius: 8,
    absoluteBoundingBox: {x: 0, y: 0, width: 300, height: 80},
    children: [
        {
            id: '3:2', name: 'Icon', type: 'FRAME',
            layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', layoutAlign: 'INHERIT',
            fills: [solid([1, 0.478, 0])],
            strokes: [{type: 'SOLID', color: color([0, 0, 0]), strokeWeight: 1}], strokeAlign: 'OUTSIDE',
            cornerRadius: 4,
            absoluteBoundingBox: {x: 16, y: 12, width: 24, height: 24},
        },
        {
            id: '3:3', name: 'Label', type: 'TEXT', characters: 'Row label',
            absoluteBoundingBox: {x: 48, y: 12, width: 200, height: 24},
            style: {fontFamily: 'Inter', fontWeight: 500, fontSize: 14, letterSpacing: 0, lineHeightPx: 20, textAlignHorizontal: 'LEFT', textAlignVertical: 'CENTER'},
        },
    ],
};

test('component analysis reports padding, sizing, alignment, borders and radius', async () => {
    const report = await analyze(nodeRoute('3:1', CARD_ROW), '3:1', {useDeduplication: false});
    assert.match(report, /- Padding: 12px 16px 12px 16px \(TRBL\)\n- Horizontal Sizing: FILL\n- Vertical Sizing: HUG\n- Parent Alignment: STRETCH/);
    assert.match(report, /- Border: 2px solid #333333 align INSIDE\n- Corner radius: 8px/);
    assert.match(report, /1\. Icon \(FRAME\)[^]*?Horizontal Sizing: FIXED\n\s+Vertical Sizing: FIXED\n\s+Parent Alignment: INHERIT/);
    assert.match(report, /Border: 1px solid #000000 align OUTSIDE\n\s+Corner radius: 4px/);
    assert.match(report, /- Add spacing with SizedBox\(width: 8\)/);
    assert.match(report, /- CrossAxisAlignment: CrossAxisAlignment\.end/);
});

for (const [primary, counter, main, cross] of [
    ['CENTER', 'MAX', 'MainAxisAlignment.center', 'CrossAxisAlignment.end'],
    ['SPACE_BETWEEN', 'MIN', 'MainAxisAlignment.spaceBetween', 'CrossAxisAlignment.start'],
    ['MAX', 'CENTER', 'MainAxisAlignment.end', 'CrossAxisAlignment.center'],
    ['MIN', 'BASELINE', 'MainAxisAlignment.start', 'CrossAxisAlignment.baseline'],
]) {
    test(`layout guidance maps ${primary}/${counter} to ${main} and ${cross}`, async () => {
        const report = await analyze(nodeRoute('3:1', {...CARD_ROW, primaryAxisAlignItems: primary, counterAxisAlignItems: counter}), '3:1', {useDeduplication: false});
        assert.match(report, new RegExp(`- MainAxisAlignment: ${main.replace('.', '\\.')}\\n`));
        assert.match(report, new RegExp(`- CrossAxisAlignment: ${cross.replace('.', '\\.')}\\n`));
    });
}

test('inspect_component_structure reports sizing and alignment for the component and its children', async () => {
    const {text, requests} = await callToolOffline(nodeRoute('3:1', CARD_ROW), 'inspect_component_structure',
        {input: FILE_KEY, nodeId: '3:1', userDefinedComponent: true});
    assert.equal(requests.length, 1);
    assert.match(text, /Horizontal Sizing: FILL\nVertical Sizing: HUG\nParent Alignment: STRETCH/);
    assert.match(text, /1\. Icon \(FRAME\)[^]*?Horizontal Sizing: FIXED\n\s+Vertical Sizing: FIXED\n\s+Parent Alignment: INHERIT/);
    assert.match(text, /2\. Label \(TEXT\)/);
});

test('each text keeps its own TextStyle (a later text never reuses the first one)', async () => {
    const code = await analyze(nodeRoute('9:1', frame('9:1', [solid([1, 0, 0])], [
        textNode('9:2', 'Title', 32, 700),
        textNode('9:3', 'Body', 14, 400),
    ])), '9:1');
    assert.equal(textStyleOf(code, 'Title'), "TextStyle(fontFamily: 'Inter', fontSize: 32, fontWeight: FontWeight.bold, color: Color(0xFF000000))");
    assert.equal(textStyleOf(code, 'Body'), "TextStyle(fontFamily: 'Inter', fontSize: 14, color: Color(0xFF000000))");
});

test('text under a gradient parent keeps its TextStyle', async () => {
    const code = await analyze(nodeRoute('9:1', frame('9:1', [linear([1, 0, 0], [0, 0, 1])], [
        textNode('9:2', 'Hello', 32, 700),
    ])), '9:1');
    assert.equal(textStyleOf(code, 'Hello'), "TextStyle(fontFamily: 'Inter', fontSize: 32, fontWeight: FontWeight.bold, color: Color(0xFF000000))");
});

// Style dedup: pairs of sibling nodes that must share one style (merge) or get
// two (split). Cases follow the dedup review probe; E pins a known defect.
const red: Rgb = [1, 0, 0];
const DEDUP_CASES: Array<{name: string; a: object; b: object; expect: 'merge' | 'split'; kind: 'decoration' | 'text'}> = [
    {name: 'A different gradients', expect: 'split', kind: 'decoration',
        a: frame('8:1', [linear(red, [0, 0, 1])]), b: frame('8:2', [linear([0, 1, 0], [0, 0, 0])])},
    {name: 'B identical gradients', expect: 'merge', kind: 'decoration',
        a: frame('8:1', [linear(red, [0, 0, 1])]), b: frame('8:2', [linear(red, [0, 0, 1])])},
    {name: 'C hidden-only effects vs no effects', expect: 'merge', kind: 'decoration',
        a: frame('8:1', [solid(red)], [], {effects: [shadow('DROP_SHADOW', 4, false)]}), b: frame('8:2', [solid(red)])},
    {name: 'D different drop shadows, same fill', expect: 'split', kind: 'decoration',
        a: frame('8:1', [solid(red)], [], {effects: [shadow('DROP_SHADOW', 4)]}), b: frame('8:2', [solid(red)], [], {effects: [shadow('DROP_SHADOW', 12)]})},
    // Known defect (backlog B3.18): opacity is ignored, so these merge. Flip to 'split' when fixed.
    {name: 'E same colour, different opacity (known defect B3.18)', expect: 'merge', kind: 'decoration',
        a: frame('8:1', [solid(red, 0.5)]), b: frame('8:2', [solid(red)])},
    {name: 'F uniform radius as number vs per-corner', expect: 'merge', kind: 'decoration',
        a: frame('8:1', [solid(red)], [], {cornerRadius: 8}), b: frame('8:2', [solid(red)], [], {rectangleCornerRadii: [8, 8, 8, 8]})},
    {name: 'G text with no fills vs empty fills', expect: 'merge', kind: 'text',
        a: {...textNode('8:1', 'NoFills', 16, 400), fills: undefined}, b: textNode('8:2', 'EmptyFills', 16, 400, [])},
    {name: 'H different text sizes', expect: 'split', kind: 'text',
        a: textNode('8:1', 'Big', 24, 400), b: textNode('8:2', 'Small', 12, 400)},
    {name: 'I different inner shadows, same fill', expect: 'split', kind: 'decoration',
        a: frame('8:1', [solid(red)], [], {effects: [shadow('INNER_SHADOW', 2)]}), b: frame('8:2', [solid(red)], [], {effects: [shadow('INNER_SHADOW', 9)]})},
];

for (const c of DEDUP_CASES) {
    test(`style dedup ${c.expect}s: ${c.name}`, async () => {
        const report = await analyze(nodeRoute('8:0', frame('8:0', [], [c.a, c.b])), '8:0');
        const nameOf = (node: any) => node.name;
        const pick = (refs: string[]) => refs.filter((ref) => ref.startsWith(c.kind));
        const refA = pick(refsOf(report, nameOf(c.a)));
        const refB = pick(refsOf(report, nameOf(c.b)));
        assert.equal(refA.length, 1, `${nameOf(c.a)} should have one ${c.kind} style, refs: ${JSON.stringify(refsOf(report, nameOf(c.a)))}`);
        assert.equal(refB.length, 1, `${nameOf(c.b)} should have one ${c.kind} style, refs: ${JSON.stringify(refsOf(report, nameOf(c.b)))}`);
        if (c.expect === 'merge') assert.equal(refA[0], refB[0]);
        else assert.notEqual(refA[0], refB[0]);
    });
}

test('style dedup merges identical non-uniform padding across calls and splits a different one', async () => {
    const padded = (id: string, [t, r, b, l]: number[]) =>
        frame(id, [solid(red)], [], {paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l});
    const figma = await startFakeFigma({
        ...nodeRoute('7:1', padded('7:1', [4, 8, 12, 16])),
        ...nodeRoute('7:2', padded('7:2', [4, 8, 12, 16])),
        ...nodeRoute('7:3', padded('7:3', [4, 8, 12, 20])),
    });
    const reports: string[] = [];
    try {
        // One server process: the style library persists across calls, as it does for a consumer.
        await withServer(async (server) => {
            await server.initialize();
            for (const nodeId of ['7:1', '7:2', '7:3']) {
                const reply = await server.request('tools/call', {name: 'analyze_figma_component', arguments: {
                    input: FILE_KEY, nodeId, exportAssets: false, userDefinedComponent: true,
                }});
                reports.push(reply.result.content[0].text);
            }
        }, {env: {FIGMA_API_BASE_URL: figma.baseUrl}});
    } finally {
        await figma.close();
    }
    const paddingRef = (report: string) => report.match(/• padding: (padding\S+)/)?.[1];
    assert.ok(paddingRef(reports[0]), 'first call must report a padding style');
    assert.equal(paddingRef(reports[1]), paddingRef(reports[0]));
    assert.notEqual(paddingRef(reports[2]), paddingRef(reports[0]));
});
