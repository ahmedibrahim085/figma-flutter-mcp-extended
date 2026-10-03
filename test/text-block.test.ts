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

/** The analyze_figma_component output with the generated widget code. */
async function output(node: {id: string}) {
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    return (await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args)).text;
}

/** The `lines`-line block starting at the line `first`, each line's indentation removed. */
async function block(node: {id: string}, first: string, lines: number) {
    const all = (await output(node)).split('\n').map((line) => line.trim());
    const start = all.indexOf(first);
    return start < 0 ? undefined : all.slice(start, start + lines).join('\n').replace(/,$/, '');
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
    assert.equal(await block(node, 'SizedBox(', 11), expected);
});

test('the same alignment in an auto-height box is a plain Text', async () => {
    const node = frameWithText('Order total', {textAlignHorizontal: 'LEFT', textAlignVertical: 'BOTTOM', textAutoResize: 'HEIGHT'},
        {x: 0, y: 0, width: 200, height: 60});

    const expected = ['Text(', "'Order total',", STYLE_LINE, 'textAlign: TextAlign.left,', ')'].join('\n');
    assert.equal(await block(node, 'Text(', 5), expected);
});

test('centre alignment on both axes in a fixed box gives Alignment.center', async () => {
    const node = frameWithText('Order total', {textAlignHorizontal: 'CENTER', textAlignVertical: 'CENTER', textAutoResize: 'NONE'},
        {x: 0, y: 0, width: 200, height: 48});

    const expected = ['SizedBox(', 'height: 48,', 'child: Align(', 'alignment: Alignment.center, // inferred: vertical alignment inside the fixed-height box'].join('\n');
    assert.equal(await block(node, 'SizedBox(', 4), expected);
});

test('paragraph spacing splits the text into Texts separated by a gap, labelled inferred', async () => {
    const node = frameWithText('First paragraph\nSecond paragraph', {paragraphSpacing: 12});

    const expected = [
        'Column(',
        'mainAxisSize: MainAxisSize.min,',
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
    assert.equal(await block(node, 'Column(', 15), expected);
});

test('paragraph indent, list spacing and vertical trim are named in a "not converted" comment', async () => {
    const node = frameWithText('Order total', {paragraphIndent: 16, listSpacing: 8, leadingTrim: 'CAP_HEIGHT'});

    const expected = ['// not converted: paragraphIndent 16, listSpacing 8, leadingTrim CAP_HEIGHT', 'Text(', "'Order total',", STYLE_LINE, ')'].join('\n');
    const first = '// not converted: paragraphIndent 16, listSpacing 8, leadingTrim CAP_HEIGHT';
    assert.equal(await block(node, first, 5), expected);
});

test('leadingTrim NONE is Figma\'s default and is not named as unconverted', async () => {
    const node = frameWithText('Order total', {leadingTrim: 'NONE'});

    // The comment would sit on the line before Text(, so check the whole output, not the Text block.
    const text = await output(node);
    assert.doesNotMatch(text, /not converted/);
    assert.match(text, /'Order total',/);
});

// Measured with flutter test on the generated widget (200 x 96 box, BOTTOM + RIGHT, two paragraphs):
// the paragraphs rendered at the top-left because the Column filled the box and aligned its children
// to the start. It must shrink to its content and align children with the text's horizontal alignment.
for (const [horizontal, cross] of [['LEFT', 'start'], ['CENTER', 'center'], ['RIGHT', 'end'], ['JUSTIFIED', 'start']] as const) {
    test(`${horizontal} paragraphs align their Column children to ${cross} and the Column shrinks to its content`, async () => {
        const node = frameWithText('First\nSecond', {paragraphSpacing: 8, textAlignHorizontal: horizontal});

        const expected = ['Column(', 'mainAxisSize: MainAxisSize.min,', `crossAxisAlignment: CrossAxisAlignment.${cross}, // inferred: paragraph spacing as separate Texts`].join('\n');
        assert.equal(await block(node, 'Column(', 3), expected);
    });
}

// Review findings (Spec, ticket 05): each case below let a mutant survive or produced a wrong layout.
for (const [name, style, box, first, lines, expected] of [
    ['TRUNCATE is a fixed-height box too', {textAlignVertical: 'BOTTOM', textAutoResize: 'TRUNCATE'}, 48, 'SizedBox(', 4,
        ['SizedBox(', 'height: 48,', 'child: Align(', 'alignment: Alignment.bottomLeft, // inferred: vertical alignment inside the fixed-height box']],
    ['JUSTIFIED sits on the left of the box', {textAlignHorizontal: 'JUSTIFIED', textAlignVertical: 'BOTTOM', textAutoResize: 'NONE'}, 48, 'SizedBox(', 4,
        ['SizedBox(', 'height: 48,', 'child: Align(', 'alignment: Alignment.bottomLeft, // inferred: vertical alignment inside the fixed-height box']],
    ['TOP in a fixed box needs no wrapper', {textAlignVertical: 'TOP', textAutoResize: 'NONE'}, 48, 'Text(', 4,
        ['Text(', "'Order total',", STYLE_LINE, ')']],
    ['a fixed box with no height cannot be wrapped', {textAlignVertical: 'BOTTOM', textAutoResize: 'NONE'}, undefined, 'Text(', 4,
        ['Text(', "'Order total',", STYLE_LINE, ')']],
] as const) {
    test(name, async () => {
        const node = frameWithText('Order total', style, box ? {x: 0, y: 0, width: 200, height: box} : undefined);

        const want = expected.join('\n');
        assert.equal(await block(node, first, lines), want);
    });
}

test('truncated text is not split into paragraphs; its paragraph spacing is named as not converted', async () => {
    // Splitting would give every paragraph the box's maxLines: flutter test reported a RenderFlex overflow.
    const node = frameWithText('One\nTwo', {paragraphSpacing: 12, textAutoResize: 'TRUNCATE'}, {x: 0, y: 0, width: 200, height: 48});

    const text = await output(node);
    assert.match(text, /\/\/ not converted: paragraphSpacing 12 \(truncated text\)/);
    assert.doesNotMatch(text, /paragraph spacing as separate Texts/);
});

test('text with mixed-style runs keeps its runs; its paragraph spacing is named as not converted', async () => {
    const node = frameWithText('One\nTwo', {paragraphSpacing: 12});
    Object.assign(node.children[0], {characterStyleOverrides: [1, 1, 1], styleOverrideTable: {1: {fontWeight: 700}}});

    const text = await output(node);
    assert.match(text, /\/\/ not converted: paragraphSpacing 12 \(mixed-style runs\)/);
    assert.match(text, /Text\.rich\(/);
});
