// A visible stroke becomes a Flutter border in the style definitions, with Figma's colour, weight and alignment.
// No fixture or MAGED frame has a stroke (MAGED's one stroked node is a vector), so the nodes are written in Figma's
// REST shape (strokes, strokeWeight, strokeAlign, individualStrokeWeights). Expected Dart is written by hand from
// api.flutter.dev: Border.all, Border, BorderSide.none and BorderSide.strokeAlign{Inside,Center,Outside}
// (Flutter's default is inside, so INSIDE prints no strokeAlign).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

const grey = {r: 0.2, g: 0.2, b: 0.2, a: 1}; // 0xFF333333
const stroke = (extra: object = {}) => ({type: 'SOLID', color: grey, ...extra});
const frame = (extra: object, children: object[] = []) => ({
    id: '70:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL',
    fills: [{type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}}],
    absoluteBoundingBox: {x: 0, y: 0, width: 100, height: 100}, children, ...extra,
});

/** The BoxDecoration definitions that generate_flutter_implementation prints, in order. */
async function decorations(node: {id: string}): Promise<string[]> {
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: node.id});
    return [...text.matchAll(/^final decoration\w+ = (BoxDecoration\([^]*?\n\));$/gm)].map((match) => match[1]);
}

const RED = '  color: Color(0xFFFF0000),\n';
const CASES: Array<{name: string; node: object; dart: string}> = [
    {name: 'a 2px INSIDE stroke is Border.all without strokeAlign (Flutter\'s default is inside)',
        node: frame({strokes: [stroke()], strokeWeight: 2, strokeAlign: 'INSIDE'}),
        dart: `BoxDecoration(\n${RED}  border: Border.all(\n    color: Color(0xFF333333),\n    width: 2,\n  ),\n)`},
    {name: 'a CENTER stroke adds strokeAlignCenter',
        node: frame({strokes: [stroke()], strokeWeight: 1, strokeAlign: 'CENTER'}),
        dart: `BoxDecoration(\n${RED}  border: Border.all(\n    color: Color(0xFF333333),\n    width: 1,\n    strokeAlign: BorderSide.strokeAlignCenter,\n  ),\n)`},
    {name: 'an OUTSIDE stroke adds strokeAlignOutside',
        node: frame({strokes: [stroke()], strokeWeight: 3, strokeAlign: 'OUTSIDE'}),
        dart: `BoxDecoration(\n${RED}  border: Border.all(\n    color: Color(0xFF333333),\n    width: 3,\n    strokeAlign: BorderSide.strokeAlignOutside,\n  ),\n)`},
    {name: 'individualStrokeWeights are one BorderSide per side, a zero side is BorderSide.none',
        node: frame({strokes: [stroke()], strokeWeight: 4, strokeAlign: 'INSIDE', individualStrokeWeights: {top: 1, right: 2, bottom: 0, left: 4}}),
        dart: `BoxDecoration(\n${RED}  border: Border(\n    top: BorderSide(color: Color(0xFF333333), width: 1),\n    right: BorderSide(color: Color(0xFF333333), width: 2),\n    bottom: BorderSide.none,\n    left: BorderSide(color: Color(0xFF333333), width: 4),\n  ),\n)`},
    {name: 'equal individualStrokeWeights are one Border.all',
        node: frame({strokes: [stroke()], strokeWeight: 2, strokeAlign: 'INSIDE', individualStrokeWeights: {top: 2, right: 2, bottom: 2, left: 2}}),
        dart: `BoxDecoration(\n${RED}  border: Border.all(\n    color: Color(0xFF333333),\n    width: 2,\n  ),\n)`},
    {name: 'a missing strokeWeight is not set by Figma, not 1',
        node: frame({strokes: [stroke()], strokeAlign: 'INSIDE'}),
        dart: `BoxDecoration(\n${RED}  border: Border.all(\n    color: Color(0xFF333333),\n    // width: strokeWeight not set by Figma\n  ),\n)`},
    {name: 'the stroke paint\'s opacity is in the colour',
        node: frame({strokes: [stroke({opacity: 0.5})], strokeWeight: 2, strokeAlign: 'INSIDE'}),
        dart: `BoxDecoration(\n${RED}  border: Border.all(\n    color: Color(0x80333333),\n    width: 2,\n  ),\n)`},
    {name: 'a border and a radius come together',
        node: frame({strokes: [stroke()], strokeWeight: 2, strokeAlign: 'INSIDE', cornerRadius: 8}),
        dart: `BoxDecoration(\n${RED}  border: Border.all(\n    color: Color(0xFF333333),\n    width: 2,\n  ),\n  borderRadius: BorderRadius.circular(8),\n)`},
    {name: 'an invisible stroke prints no border',
        node: frame({strokes: [stroke({visible: false})], strokeWeight: 2, strokeAlign: 'INSIDE'}),
        dart: `BoxDecoration(\n${RED})`},
];

for (const {name, node, dart} of CASES) {
    test(`style definitions: ${name}`, async () => {
        assert.deepEqual(await decorations(node as {id: string}), [dart]);
    });
}

test('a child with a stroke gets the border in its own decoration', async () => {
    const child = {id: '70:2', name: 'Inner', type: 'FRAME', fills: [{type: 'SOLID', color: {r: 0, g: 0, b: 1, a: 1}}],
        strokes: [stroke()], strokeWeight: 2, strokeAlign: 'INSIDE', absoluteBoundingBox: {x: 0, y: 0, width: 50, height: 50}, children: []};

    const all = await decorations(frame({}, [child]));

    assert.ok(all.some((code) => code.includes('color: Color(0xFF0000FF)') && code.includes('border: Border.all(\n    color: Color(0xFF333333),\n    width: 2,')), all.join('\n---\n'));
});
