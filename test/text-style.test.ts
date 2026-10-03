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

/** The TextStyle generated for `label` in the analysis report's widget code. */
async function generatedTextStyle(node: {id: string}, label: string) {
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);
    return text.slice(text.indexOf(`'${label}',`)).match(/style: (TextStyle\([^\n]*\)),?\n/)?.[1];
}

test('the widget code emits the Figma TextStyle fields for a text', async () => {
    const style = await generatedTextStyle(frameWithText('Order total', restStyle(14, 500)), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)";
    assert.equal(style, expected);
});

test('a bold weight is FontWeight.w700', async () => {
    const style = await generatedTextStyle(frameWithText('Order total', restStyle(20, 700)), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 20, fontWeight: FontWeight.w700, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)";
    assert.equal(style, expected);
});

test('a light weight is FontWeight.w300', async () => {
    const style = await generatedTextStyle(frameWithText('Fine print', restStyle(12, 300)), 'Fine print');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 12, fontWeight: FontWeight.w300, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)";
    assert.equal(style, expected);
});

// No word decides a text's colour: error, success and warning words keep the
// design colour, like any other text.
for (const label of ['Invalid password', 'Warning: low balance', 'Payment successful', 'Card expired', 'Download failed']) {
    test(`"${label}" keeps its design colour`, async () => {
        const style = await generatedTextStyle(frameWithText(label, restStyle(14, 500)), label);

        const expected = "TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even)";
        assert.equal(style, expected);
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
    test(name, async () => {
        const emitted = await generatedTextStyle(frameWithText('Sample copy', style, fill), 'Sample copy');

        assert.equal(emitted, expected);
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

test('generate_flutter_implementation puts the full TextStyle in the widget', async () => {
    const node = frameWithText('Sample copy', restStyle(16, 600, {letterSpacing: 1, italic: true}));
    const generated = await callToolOffline(nodeRoute(node.id, node), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: node.id});

    assert.match(generated.text, /style: TextStyle\(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight\.w600, fontStyle: FontStyle\.italic, color: Color\(0xFF112233\), letterSpacing: 1, height: 1\.5, leadingDistribution: TextLeadingDistribution\.even\),/);
});

/** The generated `Text(...)` widget for `label`, with each line's indentation removed. */
async function generatedTextWidget(node: {id: string}, label: string) {
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);
    const lines = text.split('\n').map((line) => line.trim());
    const start = lines.findIndex((line, i) => line === 'Text(' && lines[i + 1] === `'${label}',`);
    if (start < 0) return undefined;
    const end = lines.findIndex((line, i) => i > start && /^\),?$/.test(line));
    return lines.slice(start, end + 1).join('\n').replace(/,$/, '');
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
    // A word starts after any non-letter, not only after a space; the apostrophe stays inside the word.
    ['TITLE capitalises a word after punctuation', "(order total) o'neil", {textCase: 'TITLE'}, undefined,
        `Text(\n'(Order Total) O\\'neil',\n${PLAIN_STYLE}\n)`],
    // LEFT is emitted, not left to Flutter's start: start is right-aligned in RTL text (owner decision).
    ['LEFT gives textAlign left', 'Order total', {textAlignHorizontal: 'LEFT'}, undefined,
        `Text(\n'Order total',\n${PLAIN_STYLE}\ntextAlign: TextAlign.left,\n)`],
    ['CENTER gives textAlign center', 'Order total', {textAlignHorizontal: 'CENTER'}, undefined,
        `Text(\n'Order total',\n${PLAIN_STYLE}\ntextAlign: TextAlign.center,\n)`],
    ['JUSTIFIED gives textAlign justify', 'Order total', {textAlignHorizontal: 'JUSTIFIED'}, undefined,
        `Text(\n'Order total',\n${PLAIN_STYLE}\ntextAlign: TextAlign.justify,\n)`],
    ['ending truncation with maxLines gives maxLines and ellipsis', 'Order total', {textTruncation: 'ENDING', maxLines: 2}, undefined,
        `Text(\n'Order total',\n${PLAIN_STYLE}\nmaxLines: 2,\noverflow: TextOverflow.ellipsis,\n)`],
    // No maxLines on a fixed 60 px box with 24 px lines: floor(60 / 24) = 2, labelled inferred.
    ['ending truncation without maxLines infers the line count from the box', 'Order total', {textTruncation: 'ENDING'}, 60,
        `Text(\n'Order total',\n${PLAIN_STYLE}\nmaxLines: 2, // inferred: floor(boxHeight / lineHeightPx)\noverflow: TextOverflow.ellipsis,\n)`],
    // A 10 px box is shorter than one 24 px line: still at least one line.
    ['a box shorter than one line still gives one line', 'Order total', {textTruncation: 'ENDING'}, 10,
        `Text(\n'Order total',\n${PLAIN_STYLE}\nmaxLines: 1, // inferred: floor(boxHeight / lineHeightPx)\noverflow: TextOverflow.ellipsis,\n)`],
    // TRUNCATE (legacy auto-resize) ellipsises at the box; Figma's maxLines applies only to ENDING.
    ['TRUNCATE takes the line count from the box, not maxLines', 'Order total', {textAutoResize: 'TRUNCATE', maxLines: 5}, 48,
        `Text(\n'Order total',\n${PLAIN_STYLE}\nmaxLines: 2, // inferred: floor(boxHeight / lineHeightPx)\noverflow: TextOverflow.ellipsis,\n)`],
    // No maxLines and no box: Flutter would drop every line after the first, so the gap is named.
    ['truncation with no line count says so', 'Order total', {textTruncation: 'ENDING'}, undefined,
        `Text(\n'Order total',\n${PLAIN_STYLE}\noverflow: TextOverflow.ellipsis, // maxLines unknown: Figma gave no line count or box height\n)`],
] as const) {
    test(`${name}`, async () => {
        const node = frameWithText(characters, restStyle(16, 400, style));
        if (box) Object.assign(node.children[0], {absoluteBoundingBox: {x: 0, y: 0, width: 200, height: box}});
        // The label a widget is found by is the string as it appears in the code.
        const label = expected.split('\n')[1].slice(1, -2);

        assert.equal(await generatedTextWidget(node, label), expected);
    });
}

test('SMALL_CAPS gives an smcp font feature, labelled inferred', async () => {
    const style = await generatedTextStyle(frameWithText('Order total', restStyle(16, 400, {textCase: 'SMALL_CAPS'})), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even, fontFeatures: [FontFeature.enable('smcp')] /* inferred */)";
    assert.equal(style, expected);
});

test('SMALL_CAPS_FORCED gives smcp and c2sc font features', async () => {
    const style = await generatedTextStyle(frameWithText('Order total', restStyle(16, 400, {textCase: 'SMALL_CAPS_FORCED'})), 'Order total');

    const expected = "TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even, fontFeatures: [FontFeature.enable('smcp'), FontFeature.enable('c2sc')] /* inferred */)";
    assert.equal(style, expected);
});

test('a newline in the text is escaped in the Dart string', async () => {
    const widget = await generatedTextWidget(frameWithText('Line one\nLine two', restStyle(16, 400)), 'Line one\\nLine two');

    const expected = `Text(\n'Line one\\nLine two',\n${PLAIN_STYLE}\n)`;
    assert.equal(widget, expected);
});

// A text that reads like a button label is still a Text, escaped and letter-cased like any other.
test('a button-like label is escaped and letter-cased like any other text', async () => {
    const widget = await generatedTextWidget(frameWithText("submit $5 it's", restStyle(16, 400, {textCase: 'UPPER'})), "SUBMIT \\$5 IT\\'S");

    const expected = `Text(\n'SUBMIT \\$5 IT\\'S',\n${PLAIN_STYLE}\n)`;
    assert.equal(widget, expected);
});

// No word in a text decides the widget: every one is a Text with its own style.
for (const label of ['Save changes', 'Cancellation policy', 'Address', 'Visit our website', 'Elite members', 'Learn more', 'Home']) {
    test(`"${label}" is a Text with its own style`, async () => {
        const widget = await generatedTextWidget(frameWithText(label, restStyle(16, 400)), label);

        const expected = `Text(\n'${label}',\n${PLAIN_STYLE}\n)`;
        assert.equal(widget, expected);
    });
}

test('a text without a style gets no theme role', async () => {
    const node = {id: '21:1', name: 'Text Holder', type: 'FRAME', layoutMode: 'VERTICAL', fills: [],
        children: [{id: '21:2', name: 'Unstyled', type: 'TEXT', characters: 'Unstyled', fills: []}]};
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);

    assert.doesNotMatch(text, /textTheme\./);
    assert.match(text, /Text\(\s*'Unstyled'/);
});

test('a text keeps its interactions: the report passes them through for the agent', async () => {
    const node = frameWithText('Open details', restStyle(16, 400));
    (node.children[0] as any).interactions = [
        {trigger: {type: 'ON_CLICK'}, actions: [{type: 'NODE', destinationId: '5:5', navigation: 'NAVIGATE'}]},
        {trigger: {type: 'ON_HOVER'}, actions: [{type: 'URL', url: 'https://example.com/help'}]},
    ];
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);

    assert.match(text, /Interactions: ON_CLICK → NODE NAVIGATE 5:5; ON_HOVER → URL https:\/\/example\.com\/help/);
    assert.doesNotMatch(text, /ElevatedButton|TextButton/);
});

test('an interaction on a text nested two and three levels down is reported with its layer name and id', async () => {
    const node = {id: '21:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], children: [
        {id: '21:2', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], children: [
            {id: '21:3', name: 'Buy\nnow', type: 'TEXT', characters: 'Buy now', fills: [{type: 'SOLID', color: TEAL}], style: restStyle(16, 400),
                interactions: [{trigger: {type: 'ON_CLICK'}, actions: [{type: 'NODE', destinationId: '9:9', navigation: 'NAVIGATE'}]}]},
            {id: '21:4', name: 'Inner', type: 'FRAME', layoutMode: 'HORIZONTAL', fills: [], children: [
                {id: '21:5', name: 'Cancel', type: 'TEXT', characters: 'Cancel', fills: [{type: 'SOLID', color: TEAL}], style: restStyle(16, 400),
                    interactions: [{trigger: {type: 'ON_CLICK'}, actions: [{type: 'BACK'}]}]},
            ]},
        ]},
    ]};
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);

    assert.match(text, /Buy now \(21:3\)[^\n]*\n\s*Interactions: ON_CLICK → NODE NAVIGATE 9:9/);
    assert.equal(text.match(/Interactions: ON_CLICK → NODE NAVIGATE 9:9/g)?.length, 1);
    assert.match(text, /Cancel \(21:5\)[^\n]*\n\s*Interactions: ON_CLICK → BACK/);
});

test('an interaction with no trigger, no actions or an action without a target is still reported', async () => {
    const node = frameWithText('Open details', restStyle(16, 400));
    (node.children[0] as any).interactions = [
        {trigger: null, actions: [{type: 'CLOSE'}]},
        {trigger: {type: 'ON_DRAG'}, actions: []},
    ];
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);

    assert.match(text, /Interactions: no trigger → CLOSE; ON_DRAG → no action/);
});

test('the analysed node keeps its own interactions in the report', async () => {
    const node = frameWithText('Open details', restStyle(16, 400));
    (node as any).interactions = [{trigger: {type: 'ON_CLICK'}, actions: [{type: 'BACK'}]}];
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);

    assert.match(text, /Interactions: ON_CLICK → BACK/);
});

test('children keep their Figma order, whatever their size or type', async () => {
    const node = {id: '21:1', name: 'Holder', type: 'FRAME', layoutMode: 'VERTICAL', fills: [],
        absoluteBoundingBox: {x: 0, y: 0, width: 400, height: 400},
        children: [
            {id: '21:2', name: 'Small first', type: 'TEXT', characters: 'Small first', fills: [], style: restStyle(12, 400),
                absoluteBoundingBox: {x: 0, y: 0, width: 10, height: 10}},
            {id: '21:3', name: 'Big second', type: 'FRAME', fills: [{type: 'SOLID', color: TEAL}],
                absoluteBoundingBox: {x: 0, y: 10, width: 400, height: 300}, children: []},
            {id: '21:4', name: 'Instance third', type: 'INSTANCE', fills: [], componentId: '9:9',
                absoluteBoundingBox: {x: 0, y: 310, width: 50, height: 50}, children: []},
        ]};
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);

    const order = ['Small first', 'Big second', 'Instance third'].map((name) => text.indexOf(name));
    assert.ok(order.every((i) => i >= 0), text);
    assert.deepEqual([...order].sort((a, b) => a - b), order, text);
});

test('quotes, backslashes and dollar signs are escaped in the Dart string', async () => {
    const widget = await generatedTextWidget(frameWithText("It's $5 \\ off", restStyle(16, 400)), "It\\'s \\$5 \\\\ off");

    const expected = `Text(\n'It\\'s \\$5 \\\\ off',\n${PLAIN_STYLE}\n)`;
    assert.equal(widget, expected);
});

/** The generated `Text.rich(...)` widget whose first span line matches `firstSpan`, dedented. */
async function generatedRichText(node: {id: string}, firstSpan: string) {
    const args = {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true};
    const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component', args);
    const lines = text.split('\n').map((line) => line.trim());
    const start = lines.findIndex((line, i) => line === 'Text.rich(' && lines[i + 2] === firstSpan);
    if (start < 0) return undefined;
    const end = lines.findIndex((line, i) => i > start && /^\),?$/.test(line));
    return lines.slice(start, end + 1).join('\n').replace(/,$/, '');
}

// Figma character style overrides: id 0 is the base style; each other id indexes styleOverrideTable.
const withRuns = (characters: string, overrides: number[], table: object) => {
    const node = frameWithText(characters, restStyle(16, 400));
    Object.assign(node.children[0], {characterStyleOverrides: overrides, styleOverrideTable: table});
    return node;
};

test('override runs become Text.rich spans that carry only what they override', async () => {
    // "Pay " base, "now" bold italic (fontFamily repeats the base, so it is not emitted), " or later" base.
    const node = withRuns('Pay now or later', [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        {1: {fontFamily: 'Inter', fontWeight: 700, italic: true}});

    const expected = [
        'Text.rich(',
        'TextSpan(children: [',
        "TextSpan(text: 'Pay '),",
        "TextSpan(text: 'now', style: TextStyle(fontWeight: FontWeight.w700, fontStyle: FontStyle.italic)),",
        "TextSpan(text: ' or later'),",
        ']),',
        PLAIN_STYLE,
        ')',
    ].join('\n');
    assert.equal(await generatedRichText(node, "TextSpan(text: 'Pay '),"), expected);
});

test('a run with its own fill gets its own color, and indices past the override array use the base', async () => {
    // The override array is shorter than the text: "Sale" red, then "!!" past the end is base.
    const node = withRuns('Sale!!', [3, 3, 3, 3], {3: {fills: [{type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}}]}});

    const expected = [
        'Text.rich(',
        'TextSpan(children: [',
        "TextSpan(text: 'Sale', style: TextStyle(color: Color(0xFFFF0000))),",
        "TextSpan(text: '!!'),",
        ']),',
        PLAIN_STYLE,
        ')',
    ].join('\n');
    assert.equal(await generatedRichText(node, "TextSpan(text: 'Sale', style: TextStyle(color: Color(0xFFFF0000))),"), expected);
});

test('an override array of only zeros stays a plain Text', async () => {
    const node = withRuns('Order total', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], {});

    const expected = `Text(\n'Order total',\n${PLAIN_STYLE}\n)`;
    assert.equal(await generatedTextWidget(node, 'Order total'), expected);
});

// A run that switches a base style OFF must say so explicitly, or the span inherits the base.
for (const [name, base, off, baseStyleTail, span] of [
    ['italic switched off', {italic: true}, {italic: false},
        "fontStyle: FontStyle.italic, color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even),",
        "TextSpan(text: 'then', style: TextStyle(fontStyle: FontStyle.normal)),"],
    ['underline switched off', {textDecoration: 'UNDERLINE'}, {textDecoration: 'NONE'},
        "color: Color(0xFF112233), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even, decoration: TextDecoration.underline),",
        "TextSpan(text: 'then', style: TextStyle(decoration: TextDecoration.none)),"],
] as const) {
    test(`a run with ${name} resets it explicitly`, async () => {
        const node = frameWithText('Now then', restStyle(16, 400, base));
        Object.assign(node.children[0], {characterStyleOverrides: [0, 0, 0, 0, 1, 1, 1, 1], styleOverrideTable: {1: off}});

        const widget = await generatedRichText(node, "TextSpan(text: 'Now '),");
        const expected = [
            'Text.rich(',
            'TextSpan(children: [',
            "TextSpan(text: 'Now '),",
            span,
            ']),',
            `style: TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, ${baseStyleTail}`,
            ')',
        ].join('\n');
        assert.equal(widget, expected);
    });
}

test('TITLE case across runs does not capitalise a run that starts mid-word', async () => {
    // "order total" with "de" bold: runs "or" | "de" | "r total" -> "Or" | "de" | "r Total".
    const node = withRuns('order total', [0, 0, 1, 1], {1: {fontWeight: 700}});
    Object.assign(node.children[0].style, {textCase: 'TITLE'});

    const expected = [
        'Text.rich(',
        'TextSpan(children: [',
        "TextSpan(text: 'Or'),",
        "TextSpan(text: 'de', style: TextStyle(fontWeight: FontWeight.w700)),",
        "TextSpan(text: 'r Total'),",
        ']),',
        PLAIN_STYLE,
        ')',
    ].join('\n');
    assert.equal(await generatedRichText(node, "TextSpan(text: 'Or'),"), expected);
});

test('runs are dropped, not misaligned, when the text content was trimmed from node.characters', async () => {
    // Override indices address node.characters (" Order total"); the emitted content is trimmed
    // ("Order total"), so applying the indices would shift the bold run by one. It stays a plain Text.
    const node = withRuns(' Order total', [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1], {1: {fontWeight: 700}});

    const expected = `Text(\n'Order total',\n${PLAIN_STYLE}\n)`;
    assert.equal(await generatedTextWidget(node, 'Order total'), expected);
});
