import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, callToolsOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

const TEAL = {r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255, a: 1};

/** A REST-shaped TypeStyle: Figma always sends letterSpacing and a line height. */
const restStyle = (fontSize: number, fontWeight: number, extra: object = {}) => ({
    fontFamily: 'Inter', fontSize, fontWeight, letterSpacing: 0, lineHeightPx: fontSize * 1.5, lineHeightUnit: 'PIXELS', ...extra,
});

/** A vertical frame holding one TEXT node with the given style. */
const frameWithText = (label: string, style: object, fill: object = {type: 'SOLID', color: TEAL}) => ({
    id: '21:1', name: 'Text Holder', type: 'FRAME', layoutMode: 'VERTICAL', fills: [],
    children: [{id: '21:2', name: label, type: 'TEXT', characters: label, fills: [fill], style}],
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
    const styles = await textStyleOnBothPaths(frameWithText('Order total', restStyle(14, 500)), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)";
    assert.deepEqual(styles, {dedup: expected, plain: expected});
});

test('a bold weight is FontWeight.w700 on both code paths', async () => {
    const styles = await textStyleOnBothPaths(frameWithText('Order total', restStyle(20, 700)), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 20, fontWeight: FontWeight.w700, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)";
    assert.deepEqual(styles, {dedup: expected, plain: expected});
});

test('a light weight is FontWeight.w300 on both code paths', async () => {
    const styles = await textStyleOnBothPaths(frameWithText('Fine print', restStyle(12, 300)), 'Fine print');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 12, fontWeight: FontWeight.w300, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)";
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
        const {plain} = await textStyleOnBothPaths(frameWithText(label, restStyle(14, 500)), label);

        assert.equal(plain, `TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w500, color: ${colorCode}, letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)`);
    });
}

// Research 03b conversion rules. Each expected value is worked out by hand from the rule.
for (const [name, style, fill, expected] of [
    ['italic gives fontStyle', restStyle(16, 400, {italic: true}), undefined,
        "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, fontStyle: FontStyle.italic, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)"],
    ['an off-grid weight gives FontWeight(n)', restStyle(16, 450), undefined,
        "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight(450), color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)"],
    // Auto line height: 19.2 px on 16 px text is 1.2.
    ['Auto line height gives lineHeightPx / fontSize', restStyle(16, 400, {lineHeightUnit: 'INTRINSIC_%', lineHeightPx: 19.2}), undefined,
        "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: 0, height: 1.2, leadingDistribution: TextLeadingDistribution.even)"],
    // FONT_SIZE_%: 125 % is 1.25, whatever lineHeightPx says.
    ['a percentage line height gives percent / 100', restStyle(16, 400, {lineHeightUnit: 'FONT_SIZE_%', lineHeightPercentFontSize: 125, lineHeightPx: 99}), undefined,
        "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: 0, height: 1.25, leadingDistribution: TextLeadingDistribution.even)"],
    ['letter spacing is emitted in px', restStyle(16, 400, {letterSpacing: -0.4}), undefined,
        "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: -0.4, height: 1.5, leadingDistribution: TextLeadingDistribution.even)"],
    ['strikethrough gives TextDecoration.lineThrough', restStyle(16, 400, {textDecoration: 'STRIKETHROUGH'}), undefined,
        "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even, decoration: TextDecoration.lineThrough)"],
    // 50 % paint opacity on an opaque color: alpha 0x80 (round(0.5 * 255) = 128).
    ['paint opacity goes into the color alpha', restStyle(16, 400), {type: 'SOLID', color: TEAL, opacity: 0.5},
        "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0x80112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)"],
    // Color alpha 0.5 times paint opacity 0.5 is 0.25: round(0.25 * 255) = 64 = 0x40.
    ['color alpha and paint opacity multiply', restStyle(16, 400), {type: 'SOLID', color: {...TEAL, a: 0.5}, opacity: 0.5},
        "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0x40112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)"],
] as const) {
    test(`${name}, on both code paths`, async () => {
        const styles = await textStyleOnBothPaths(frameWithText('Sample copy', style, fill), 'Sample copy');

        assert.deepEqual(styles, {dedup: expected, plain: expected});
    });
}

/** Text style ref of each child, from the default path's children analysis. */
const textRefs = (report: string) => Object.fromEntries([...report.matchAll(/^\s+\d+\. (.+?) \(TEXT\)[^]*?Style refs: [^\n]*?(text\w+)/gm)]
    .map(([, name, ref]) => [name, ref]));

test('style dedup splits texts that differ only in letter spacing and merges identical full styles', async () => {
    const text = (id: string, name: string, style: object) =>
        ({id, name, type: 'TEXT', characters: name, fills: [{type: 'SOLID', color: TEAL}], style});
    const node = {
        id: '22:1', name: 'Labels', type: 'FRAME', layoutMode: 'VERTICAL', fills: [],
        children: [
            text('22:2', 'Plain A', restStyle(14, 500)),
            text('22:3', 'Tracked', restStyle(14, 500, {letterSpacing: 0.5})),
            text('22:4', 'Plain B', restStyle(14, 500)),
        ],
    };
    const {text: report} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component',
        {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true});

    const refs = textRefs(report);
    assert.ok(refs['Plain A'] && refs['Tracked'] && refs['Plain B'], JSON.stringify(refs));
    assert.notEqual(refs['Tracked'], refs['Plain A']);
    assert.equal(refs['Plain B'], refs['Plain A']);
});

test('generate_flutter_implementation prints the full TextStyle definition', async () => {
    const node = frameWithText('Sample copy', restStyle(16, 600, {letterSpacing: 1, italic: true}));
    const [, generated] = await callToolsOffline(nodeRoute(node.id, node), [
        ['analyze_figma_component', {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true}],
        ['generate_flutter_implementation', {componentNodeId: node.id}],
    ]);

    assert.match(generated.text, /^final text\w+ = TextStyle\(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight\.w600, fontStyle: FontStyle\.italic, color: Color\(0xFF112233\), letterSpacing: 1, height: 1\.5, leadingDistribution: TextLeadingDistribution\.even\);$/m);
});

/**
 * The generated `Text(...)` widget for `label` on each code path, with each line's
 * indentation removed so the two paths compare directly.
 */
async function textWidgetOnBothPaths(node: {id: string}, label: string) {
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    const dedup = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);
    const plain = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', {...args, useDeduplication: false});
    const widget = (text: string) => {
        const lines = text.split('\n').map((line) => line.trim());
        const start = lines.findIndex((line, i) => line === 'Text(' && lines[i + 1] === `'${label}',`);
        if (start < 0) return undefined;
        const end = lines.findIndex((line, i) => i > start && /^\),?$/.test(line));
        return lines.slice(start, end + 1).join('\n').replace(/,$/, '');
    };
    return {dedup: widget(dedup.text), plain: widget(plain.text)};
}

const PLAIN_STYLE = "style: TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even),";

// Text widget fields and letter case (research 03b): each expected widget is written by hand.
for (const [name, characters, style, box, expected] of [
    ['UPPER is baked into the string', 'order total', {textCase: 'UPPER'}, undefined,
        `Text(\n'ORDER TOTAL',\n${PLAIN_STYLE}\n)`],
    ['LOWER is baked into the string', 'Order Total', {textCase: 'LOWER'}, undefined,
        `Text(\n'order total',\n${PLAIN_STYLE}\n)`],
    ['TITLE capitalises each word', 'order total due', {textCase: 'TITLE'}, undefined,
        `Text(\n'Order Total Due',\n${PLAIN_STYLE}\n)`],
    ['CENTER gives textAlign center', 'Order total', {textAlignHorizontal: 'CENTER'}, undefined,
        `Text(\n'Order total',\n${PLAIN_STYLE}\ntextAlign: TextAlign.center,\n)`],
    ['JUSTIFIED gives textAlign justify', 'Order total', {textAlignHorizontal: 'JUSTIFIED'}, undefined,
        `Text(\n'Order total',\n${PLAIN_STYLE}\ntextAlign: TextAlign.justify,\n)`],
    ['ending truncation with maxLines gives maxLines and ellipsis', 'Order total', {textTruncation: 'ENDING', maxLines: 2}, undefined,
        `Text(\n'Order total',\n${PLAIN_STYLE}\nmaxLines: 2,\noverflow: TextOverflow.ellipsis,\n)`],
    // No maxLines on a fixed 60 px box with 24 px lines: floor(60 / 24) = 2, labelled inferred.
    ['ending truncation without maxLines infers the line count from the box', 'Order total', {textTruncation: 'ENDING'}, 60,
        `Text(\n'Order total',\n${PLAIN_STYLE}\nmaxLines: 2, // inferred: floor(boxHeight / lineHeightPx)\noverflow: TextOverflow.ellipsis,\n)`],
] as const) {
    test(`${name}, on both code paths`, async () => {
        const node = frameWithText(characters, restStyle(16, 400, style));
        if (box) Object.assign(node.children[0], {absoluteBoundingBox: {x: 0, y: 0, width: 200, height: box}});
        // The label a widget is found by is the string as it appears in the code.
        const label = expected.split('\n')[1].slice(1, -2);

        assert.deepEqual(await textWidgetOnBothPaths(node, label), {dedup: expected, plain: expected});
    });
}

test('SMALL_CAPS gives an smcp font feature, labelled inferred, on both code paths', async () => {
    const styles = await textStyleOnBothPaths(frameWithText('Order total', restStyle(16, 400, {textCase: 'SMALL_CAPS'})), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even, fontFeatures: [FontFeature.enable('smcp')] /* inferred */)";
    assert.deepEqual(styles, {dedup: expected, plain: expected});
});

test('quotes, backslashes and dollar signs are escaped in the Dart string, on both code paths', async () => {
    const widgets = await textWidgetOnBothPaths(frameWithText("It's $5 \\ off", restStyle(16, 400)), "It\\'s \\$5 \\\\ off");

    const expected = `Text(\n'It\\'s \\$5 \\\\ off',\n${PLAIN_STYLE}\n)`;
    assert.deepEqual(widgets, {dedup: expected, plain: expected});
});
