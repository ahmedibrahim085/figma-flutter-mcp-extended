import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

const TEAL = {r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255, a: 1};

/** A vertical frame holding one TEXT node with the given style. */
const frameWithText = (label: string, style: object) => ({
    id: '21:1', name: 'Text Holder', type: 'FRAME', layoutMode: 'VERTICAL', fills: [],
    children: [{id: '21:2', name: label, type: 'TEXT', characters: label, fills: [{type: 'SOLID', color: TEAL}], style}],
});

/**
 * The TextStyle generated for `label` on each code path: the default
 * (deduplicated) widget code, and the text guidance of `useDeduplication: false`.
 */
async function textStyleOnBothPaths(node: {id: string}, label: string) {
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    const dedup = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);
    const plain = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', {...args, useDeduplication: false});
    const styleAfter = (text: string, anchor: string) =>
        text.slice(text.indexOf(anchor)).match(/style: (TextStyle\([^\n]*\)),?\n/)?.[1];
    return {
        dedup: styleAfter(dedup.text, `'${label}',`),
        plain: styleAfter(plain.text, `"${label}"`),
    };
}

test('both code paths emit the same TextStyle for the same text', async () => {
    const styles = await textStyleOnBothPaths(frameWithText('Order total', {fontFamily: 'Inter', fontWeight: 500, fontSize: 14}), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF112233))";
    assert.deepEqual(styles, {dedup: expected, plain: expected});
});

test('a bold weight is FontWeight.bold on both code paths', async () => {
    const styles = await textStyleOnBothPaths(frameWithText('Order total', {fontFamily: 'Inter', fontWeight: 700, fontSize: 20}), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF112233))";
    assert.deepEqual(styles, {dedup: expected, plain: expected});
});

test('a light weight is FontWeight.w300 on both code paths', async () => {
    const styles = await textStyleOnBothPaths(frameWithText('Fine print', {fontFamily: 'Inter', fontWeight: 300, fontSize: 12}), 'Fine print');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 12, fontWeight: FontWeight.w300, color: Color(0xFF112233))";
    assert.deepEqual(styles, {dedup: expected, plain: expected});
});

// The plain path gives error, success and warning texts a semantic color. It must
// replace the design color, not add a second `color:` (Dart: duplicate_named_argument).
for (const [label, colorCode] of [
    ['Invalid password', 'Theme.of(context).colorScheme.error'],
    ['Warning: low balance', 'Colors.orange'],
    ['Payment successful', 'Colors.green'],
] as const) {
    test(`"${label}" has exactly one color on the plain path`, async () => {
        const {plain} = await textStyleOnBothPaths(frameWithText(label, {fontFamily: 'Inter', fontWeight: 500, fontSize: 14}), label);

        assert.equal(plain, `TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w500, color: ${colorCode})`);
    });
}
