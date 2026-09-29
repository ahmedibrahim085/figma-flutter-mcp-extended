// Text that needs more than one Text widget: vertical alignment inside a fixed-height box,
// paragraph spacing, and the Figma properties the generator does not convert (research 03b).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

const TEAL = {r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255, a: 1};
const STYLE_LINE = "style: TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even),";

/** A vertical frame holding one TEXT node with a REST-shaped style (16 px, 24 px lines). */
const frameWithText = (characters: string, style: object, box?: object) => ({
    id: '23:1', name: 'Text Holder', type: 'FRAME', layoutMode: 'VERTICAL', fills: [],
    children: [{
        id: '23:2', name: 'Copy', type: 'TEXT', characters, fills: [{type: 'SOLID', color: TEAL}],
        style: {fontFamily: 'Inter', fontSize: 16, fontWeight: 400, letterSpacing: 0, lineHeightPx: 24, lineHeightUnit: 'PIXELS', ...style},
        ...(box ? {absoluteBoundingBox: box} : {}),
    }],
});

/**
 * The `lines`-line block starting at the line `first` on each code path (default and
 * `useDeduplication: false`), each line's indentation removed so the paths compare directly.
 */
async function blockOnBothPaths(node: {id: string}, first: string, lines: number) {
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    const dedup = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);
    const plain = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', {...args, useDeduplication: false});
    const block = (text: string) => {
        const all = text.split('\n').map((line) => line.trim());
        const start = all.indexOf(first);
        return start < 0 ? undefined : all.slice(start, start + lines).join('\n').replace(/,$/, '');
    };
    return {dedup: block(dedup.text), plain: block(plain.text)};
}

test('bottom alignment in a fixed-height box wraps the Text in SizedBox + Align, labelled inferred', async () => {
    const node = frameWithText('Order total', {textAlignHorizontal: 'LEFT', textAlignVertical: 'BOTTOM', textAutoResize: 'NONE'},
        {x: 0, y: 0, width: 200, height: 60});

    const expected = [
        'SizedBox(',
        'height: 60,',
        'child: Align(',
        'alignment: Alignment.bottomLeft, // inferred: vertical alignment inside the fixed-height box',
        'child: Text(',
        "'Order total',",
        STYLE_LINE,
        'textAlign: TextAlign.left,',
        '),',
        '),',
        ')',
    ].join('\n');
    assert.deepEqual(await blockOnBothPaths(node, 'SizedBox(', 11), {dedup: expected, plain: expected});
});

test('the same alignment in an auto-height box is a plain Text', async () => {
    const node = frameWithText('Order total', {textAlignHorizontal: 'LEFT', textAlignVertical: 'BOTTOM', textAutoResize: 'HEIGHT'},
        {x: 0, y: 0, width: 200, height: 60});

    const expected = ['Text(', "'Order total',", STYLE_LINE, 'textAlign: TextAlign.left,', ')'].join('\n');
    const blocks = await blockOnBothPaths(node, 'Text(', 5);
    assert.deepEqual(blocks, {dedup: expected, plain: expected});
});

test('centre alignment on both axes in a fixed box gives Alignment.center', async () => {
    const node = frameWithText('Order total', {textAlignHorizontal: 'CENTER', textAlignVertical: 'CENTER', textAutoResize: 'NONE'},
        {x: 0, y: 0, width: 200, height: 48});

    const {dedup, plain} = await blockOnBothPaths(node, 'SizedBox(', 4);
    const expected = ['SizedBox(', 'height: 48,', 'child: Align(', 'alignment: Alignment.center, // inferred: vertical alignment inside the fixed-height box'].join('\n');
    assert.deepEqual({dedup, plain}, {dedup: expected, plain: expected});
});

test('paragraph spacing splits the text into Texts separated by a gap, labelled inferred', async () => {
    const node = frameWithText('First paragraph\nSecond paragraph', {paragraphSpacing: 12});

    const expected = [
        'Column(',
        'crossAxisAlignment: CrossAxisAlignment.start, // inferred: paragraph spacing as separate Texts',
        'children: [',
        'Text(',
        "'First paragraph',",
        STYLE_LINE,
        '),',
        'SizedBox(height: 12),',
        'Text(',
        "'Second paragraph',",
        STYLE_LINE,
        '),',
        '],',
        ')',
    ].join('\n');
    assert.deepEqual(await blockOnBothPaths(node, 'Column(', 14), {dedup: expected.replace(/,$/, ''), plain: expected.replace(/,$/, '')});
});

test('paragraph indent, list spacing and vertical trim are named in a "not converted" comment', async () => {
    const node = frameWithText('Order total', {paragraphIndent: 16, listSpacing: 8, leadingTrim: 'CAP_HEIGHT'});

    const expected = ['// not converted: paragraphIndent 16, listSpacing 8, leadingTrim CAP_HEIGHT', 'Text(', "'Order total',", STYLE_LINE, ')'].join('\n');
    const first = '// not converted: paragraphIndent 16, listSpacing 8, leadingTrim CAP_HEIGHT';
    assert.deepEqual(await blockOnBothPaths(node, first, 5), {dedup: expected, plain: expected});
});

test('leadingTrim NONE is Figma\'s default and is not named as unconverted', async () => {
    const node = frameWithText('Order total', {leadingTrim: 'NONE'});

    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    const dedup = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);
    const plain = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', {...args, useDeduplication: false});
    // The comment would sit on the line before Text(, so check the whole output, not the Text block.
    assert.doesNotMatch(dedup.text, /not converted/);
    assert.doesNotMatch(plain.text, /not converted/);
    assert.match(dedup.text, /'Order total',/);
});
