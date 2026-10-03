import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolsOffline, nodeRoute, normalizeStyleIds, FILE_KEY} from './helpers/offline-tool.ts';

// Paint and geometry fidelity (ticket 11). Expected values are written here, not read from the code.
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
const solid = (r: number, g: number, b: number, a = 1, opacity?: number) =>
    ({type: 'SOLID', color: {r, g, b, a}, ...(opacity === undefined ? {} : {opacity})});
const frame = (extra: object = {}) => ({
    id: '60:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: box(200, 100), fills: [], ...extra,
});
const text = (id: string, name: string, extra: object = {}) => ({
    id, name, type: 'TEXT', characters: name, absoluteBoundingBox: box(80, 20), fills: [solid(0, 0, 0)],
    style: {fontFamily: 'Inter', fontSize: 14, fontWeight: 400, letterSpacing: 0, lineHeightPx: 20, lineHeightUnit: 'PIXELS'}, ...extra,
});

/** The three outputs that carry paint: the default path with its style definitions, the plain path, the raw-node inspection. */
async function outputs(node: {id: string}) {
    const route = nodeRoute(node.id, node);
    const base = {input: FILE_KEY, nodeId: node.id};
    const [dedup, definitions, plain, inspect] = await callToolsOffline(route, [
        ['analyze_figma_component', {...base, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true}],
        ['generate_flutter_implementation', {componentNodeId: node.id}],
        ['analyze_figma_component', {...base, exportAssets: false, userDefinedComponent: true, useDeduplication: false}],
        ['inspect_frame_structure', base],
    ]);
    return {dedup: normalizeStyleIds(definitions.text + '\n' + dedup.text), analysis: dedup.text, plain: plain.text, inspect: inspect.text};
}

test('a shadow with alpha 0 stays alpha 0', async () => {
    const {dedup, plain} = await outputs(frame({fills: [solid(1, 0, 0)], effects: [
        {type: 'DROP_SHADOW', visible: true, color: {r: 0, g: 0, b: 0, a: 0}, offset: {x: 0, y: 2}, radius: 4, spread: 0},
    ]}));

    for (const out of [dedup, plain]) {
        assert.match(out, /color: Color\(0x00000000\)/);
        assert.doesNotMatch(out, /withOpacity|Color\(0xFF000000\)/);
    }
});

test('a 50% fill keeps its alpha, whether it is in the colour or in the paint opacity', async () => {
    const viaOpacity = await outputs(frame({fills: [solid(1, 0, 0, 1, 0.5)]}));
    const viaAlpha = await outputs(frame({fills: [solid(1, 0, 0, 0.5)]}));

    for (const out of [viaOpacity.dedup, viaOpacity.plain, viaAlpha.dedup, viaAlpha.plain]) {
        assert.match(out, /color: Color\(0x80FF0000\)/);
        assert.doesNotMatch(out, /Color\(0xFFFF0000\)/);
    }
    assert.match(viaAlpha.plain, /Background: #FF0000 \(50% opacity\)/);
});

test('two fills are both emitted, the last on top; an invisible fill is dropped', async () => {
    const blue = solid(0, 0, 1);
    const {dedup, plain} = await outputs(frame({fills: [blue, {...solid(0, 1, 0), visible: false}, solid(1, 0, 0, 1, 0.5)]}));

    for (const out of [dedup, plain]) {
        const bottom = out.indexOf('Color(0xFF0000FF)');
        const nested = out.indexOf('DecoratedBox(', bottom);
        const top = out.indexOf('Color(0x80FF0000)', nested);
        assert.ok(bottom >= 0 && nested > bottom && top > nested, `blue, then a nested DecoratedBox, then red 50%:\n${out}`);
        assert.doesNotMatch(out, /00FF00/);
    }
});

test('a missing strokeWeight is reported as not set by Figma, not as 1', async () => {
    const stroked = {strokes: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}], fills: [solid(1, 1, 1)]};
    const {plain, inspect} = await outputs(frame({...stroked, children: [frame({id: '60:2', name: 'Inner', ...stroked})]}));

    assert.match(plain, /Border: strokeWeight not set by Figma/);
    assert.match(inspect, /Border: strokeWeight not set by Figma/);
    for (const out of [plain, inspect]) assert.doesNotMatch(out, /Border: 1px|width: 1,/);
});

test('individualStrokeWeights become a per-side Border', async () => {
    const {plain} = await outputs(frame({
        strokes: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}], fills: [solid(1, 1, 1)],
        individualStrokeWeights: {top: 1, right: 2, bottom: 3, left: 4},
    }));

    assert.match(plain, /Border\(\s*top: BorderSide\(color: Color\(0xFF000000\), width: 1\),\s*right: BorderSide\(color: Color\(0xFF000000\), width: 2\),\s*bottom: BorderSide\(color: Color\(0xFF000000\), width: 3\),\s*left: BorderSide\(color: Color\(0xFF000000\), width: 4\)/);
});

test('a missing bounding box is reported as missing, not as a 0 size', async () => {
    const noBox = {...frame({id: '60:2', name: 'Floating', fills: [solid(1, 0, 0)]}), absoluteBoundingBox: undefined};
    const root = frame({layoutMode: 'NONE', children: [noBox]});
    const {dedup, plain} = await outputs(root);

    assert.match(plain, /Size: not set by Figma/);
    for (const out of [dedup, plain]) assert.doesNotMatch(out, /0×0px|width: 0,|height: 0,/);
    assert.match(dedup, /\/\/ approximate: no absoluteBoundingBox from Figma/);
    assert.doesNotMatch(dedup, /Positioned\([^)]*Floating/);
});

test('a GRID frame is reported as GRID and placed by its children, not emitted as a Column', async () => {
    const cell = (n: number, x: number, y: number) =>
        ({id: `60:${n + 2}`, name: `Cell ${n}`, type: 'FRAME', fills: [solid(0, 0, 1)], absoluteBoundingBox: {x, y, width: 40, height: 40}});
    const grid = frame({layoutMode: 'GRID', gridRowCount: 2, gridColumnCount: 2, gridRowGap: 8, gridColumnGap: 8,
        children: [cell(1, 0, 0), cell(2, 48, 0), cell(3, 0, 48), cell(4, 48, 48)]});
    const {analysis: dedup, plain} = await outputs(grid);

    assert.match(plain, /layoutMode: GRID \(2 rows × 2 columns, row gap 8, column gap 8\)/);
    assert.doesNotMatch(plain, /Use Column\(\)|Direction: vertical/);
    assert.match(dedup, /\/\/ approximate: GRID auto layout placed by its children's Figma positions/);
    assert.match(dedup, /Stack\(/);
    assert.doesNotMatch(dedup, /Column\(|Row\(/);
});

test('C19: the clamped-HUG anchor is the directional start, not Alignment.topLeft', async () => {
    const kid = (id: string) => ({id, name: 'Kid', type: 'RECTANGLE', fills: [solid(1, 0, 0)], absoluteBoundingBox: box(80, 20), layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED'});
    const clamp = frame({layoutMode: 'HORIZONTAL', clipsContent: true, absoluteBoundingBox: box(100, 20), layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG',
        maxWidth: 100, children: [kid('60:2'), kid('60:3')]});
    const {dedup} = await outputs(clamp);

    assert.match(dedup, /alignment: AlignmentDirectional\.topStart,/);
    assert.doesNotMatch(dedup, /Alignment\.topLeft/);
});

test('C20: the report prints fontWeight 400 like any other weight', async () => {
    const {plain} = await outputs(frame({children: [text('60:2', 'Body')]}));

    assert.match(plain, /Typography: Inter 14px weight: 400/);
});

test('B15: emitted offsets use one precision, the shortest round-trip number', async () => {
    const third = 100 / 3;
    const {dedup} = await outputs(frame({layoutMode: 'NONE', children: [{id: '60:2', name: 'Third', type: 'RECTANGLE', fills: [solid(1, 0, 0)],
        absoluteBoundingBox: {x: third, y: 0, width: 20, height: 20}, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED'}]}));

    assert.match(dedup, new RegExp(`left: ${String(third).replace('.', '\\.')},`));
});

test('a fill with a blend mode other than NORMAL is emitted and named as an approximation', async () => {
    const {dedup, plain} = await outputs(frame({fills: [solid(0, 0, 1), {...solid(1, 0, 0), blendMode: 'MULTIPLY'}, {...solid(0, 1, 0), blendMode: 'NORMAL'}]}));

    for (const out of [dedup, plain]) {
        assert.match(out, /\/\/ approximate: blend MULTIPLY not applied\n\s+color: Color\(0xFFFF0000\)/);
        assert.doesNotMatch(out, /blend NORMAL/);
    }
});
