// Codegen on real Figma payloads (the Text, Paints and Layout fixture frames),
// served by the fake. Like characterization.test.ts, these pin today's known-wrong
// output and name the slice that replaces each; the commit that fixes a defect
// rewrites its pin to the correct output.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {callToolOffline, callToolsOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

/** A fixture file's node entry, served under its own id. */
function fixture(file: string, nodeId: string) {
    const json = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf-8'));
    return {routes: {[`/files/${FILE_KEY}/nodes?ids=${nodeId}`]: {body: json}}, document: json.nodes[nodeId].document};
}

const ANALYZE_ARGS = {exportAssets: false, userDefinedComponent: true};

/** Generated widget class for `nodeId`. */
async function widgetCode(routes: object, nodeId: string): Promise<string> {
    const {text} = await callToolOffline(routes, 'analyze_figma_component', {input: FILE_KEY, nodeId, ...ANALYZE_ARGS, generateFlutterCode: true});
    const start = text.indexOf('class ');
    assert.ok(start >= 0, `no generated class in:\n${text}`);
    return text.slice(start);
}

/** For each child of the analysed node, its decoration style id and that decoration's Dart. */
async function childDecorations(routes: object, nodeId: string): Promise<Map<string, {id: string; code: string}>> {
    const [analysis, generated] = await callToolsOffline(routes, [
        ['analyze_figma_component', {input: FILE_KEY, nodeId, ...ANALYZE_ARGS}],
        ['generate_flutter_implementation', {componentNodeId: nodeId}],
    ]);
    const definitions = new Map([...generated.text.matchAll(/^final (decoration\w+) = (BoxDecoration\([^]*?\n\));$/gm)]
        .map(([, id, code]) => [id, code]));
    const decorations = new Map<string, {id: string; code: string}>();
    // One child block runs from its "N. Name (TYPE)" line up to the next child's; refs never cross blocks.
    for (const [, name, id] of analysis.text.matchAll(/^\s+\d+\. (.+?) \([A-Z_]+\)\n(?:(?!\s+\d+\. )[^\n]*\n)*?\s+🎨 Style refs: (decoration\w+)/gmu)) {
        decorations.set(name, {id, code: definitions.get(id)!});
    }
    return decorations;
}

test('Text fixture: each TextStyle carries the Figma style fields', async () => {
    const {routes} = fixture('text-frame.json', '1:8');
    const code = await widgetCode(routes, '1:8');

    // Heights by hand: 40/32 = 1.25; 150 % = 1.5; Auto 16.943/14 = 1.2102; 28/18 = 1.5556; Auto 19.364/16 = 1.2102.
    // The two colour cases are pinned in the colour test; these are the other nine texts.
    for (const [label, style] of [
        ['Heading styled by text style', "fontFamily: 'Inter', fontSize: 32, fontWeight: FontWeight.w700, color: Color(0xFF000000), letterSpacing: -0.5, height: 1.25, leadingDistribution: TextLeadingDistribution.even"],
        ['Body copy styled by text style, line height 150%.', "fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF000000), letterSpacing: 0, height: 1.5, leadingDistribution: TextLeadingDistribution.even"],
        ['Tracked label', "fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF000000), letterSpacing: 2, height: 1.2102, leadingDistribution: TextLeadingDistribution.even"],
        ['Raw line height 28px without a style', "fontFamily: 'Inter', fontSize: 18, fontWeight: FontWeight.w400, color: Color(0xFF000000), letterSpacing: 0, height: 1.5556, leadingDistribution: TextLeadingDistribution.even"],
        ['Centered in a fixed 320px box', "fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF000000), letterSpacing: 0, height: 1.2102, leadingDistribution: TextLeadingDistribution.even"],
        ['Right aligned', "fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF000000), letterSpacing: 0, height: 1.2102, leadingDistribution: TextLeadingDistribution.even"],
        ['Underlined link text', "fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF000000), letterSpacing: 0, height: 1.2102, leadingDistribution: TextLeadingDistribution.even, decoration: TextDecoration.underline"],
        ['This long paragraph is clipped after two lines with an ellipsis so the generator must emit maxLines and overflow handling for it.', "fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF000000), letterSpacing: 0, height: 1.2102, leadingDistribution: TextLeadingDistribution.even"],
        ['Regular then bold run', "fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, color: Color(0xFF000000), letterSpacing: 0, height: 1.2102, leadingDistribution: TextLeadingDistribution.even"],
    ]) {
        assert.ok(code.includes(`            '${label}',\n            style: TextStyle(${style}),\n          ),`), `${label}\n${code}`);
    }
});

test('Text fixture: alignment, truncation, upper case and the bold run are dropped (pins current behaviour, slice 1 replaces this)', async () => {
    const {routes} = fixture('text-frame.json', '1:8');
    const code = await widgetCode(routes, '1:8');

    assert.doesNotMatch(code, /maxLines: \d|overflow: TextOverflow|textAlign: TextAlign|Text\.rich/);
    assert.ok(code.includes("            'Tracked label',\n"), code);
});

test('Text fixture: variable and paint-style colours become literals (pins current behaviour, slice 5 replaces this)', async () => {
    const {routes, document} = fixture('text-frame.json', '1:8');
    const byName = (name: string) => document.children.find((c: any) => c.characters === name);
    // The fixture really binds these: one fill to a variable, one to a paint style.
    assert.equal(byName('Colour from variable').fills[0].boundVariables.color.type, 'VARIABLE_ALIAS');
    assert.ok(byName('Colour from paint style').styles.fill);

    const code = await widgetCode(routes, '1:8');
    assert.ok(code.includes("'Colour from variable',\n            style: TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w500, color: Color(0xFF0066E5), letterSpacing: 0, height: 1.2102, leadingDistribution: TextLeadingDistribution.even),"), code);
    assert.ok(code.includes("'Colour from paint style',\n            style: TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w500, color: Color(0xFFD93359), letterSpacing: 0, height: 1.2102, leadingDistribution: TextLeadingDistribution.even),"), code);
});

test('Text fixture: the frame\'s variable-bound item spacing is dropped (pins current behaviour, slice 2 replaces this)', async () => {
    const {routes, document} = fixture('text-frame.json', '1:8');
    // The fixture frame is a vertical auto layout with itemSpacing 12 bound to a variable.
    assert.equal(document.itemSpacing, 12);
    assert.equal(document.boundVariables.itemSpacing.type, 'VARIABLE_ALIAS');

    const code = await widgetCode(routes, '1:8');
    // No spacing between the texts: the Column opens straight onto the first Text.
    assert.ok(code.includes("      child: Column(\n        children: [\n          Text(\n            'Heading styled by text style',"), code);
    assert.doesNotMatch(code, /spacing: |SizedBox\(height: 12/);
});

test('Paints fixture: shape children produce no widgets (pins current behaviour, slice 2 replaces this)', async () => {
    const {routes, document} = fixture('paints-frame.json', '1:20');
    assert.equal(document.children.length, 13);

    const code = await widgetCode(routes, '1:20');
    assert.ok(code.includes('      child: Row(\n        children: [\n        ],\n      ),'), code);
});

test('Paints fixture: gradients and a second fill are dropped from the decoration (pins current behaviour, slice 3 replaces this)', async () => {
    const {routes} = fixture('paints-frame.json', '1:20');
    const decorations = await childDecorations(routes, '1:20');

    const radiusOnly = 'BoxDecoration(\n  borderRadius: BorderRadius.circular(8),\n)';
    const gradients = ['Paint / linear left-right', 'Paint / linear top-bottom', 'Paint / linear diagonal',
        'Paint / radial centred', 'Paint / radial offset ellipse', 'Paint / angular', 'Paint / diamond'];
    for (const name of gradients) {
        assert.equal(decorations.get(name)?.code, radiusOnly, name);
    }
    // Gradient direction and centre are dropped from the style key, so the three linear
    // swatches share one style and the two radial ones another.
    const idOf = (name: string) => decorations.get(name)!.id;
    assert.equal(new Set(gradients.slice(0, 3).map(idOf)).size, 1);
    assert.equal(new Set(gradients.slice(3, 5).map(idOf)).size, 1);
    assert.equal(new Set(gradients.map(idOf)).size, 4);
    // Gradient over solid keeps only the solid; the 50% fill opacity is lost too.
    assert.equal(decorations.get('Paint / gradient over solid (2 fills)')?.code, 'BoxDecoration(\n  color: Color(0xFFF2F2F2),\n  borderRadius: BorderRadius.circular(8),\n)');
    assert.equal(decorations.get('Paint / solid 50% opacity')?.code, 'BoxDecoration(\n  color: Color(0xFF0066E5),\n  borderRadius: BorderRadius.circular(8),\n)');
});

test('Paints fixture: image fills lose the image and their scale mode (pins current behaviour, slice 7 replaces this)', async () => {
    const {routes} = fixture('paints-frame.json', '1:20');
    const decorations = await childDecorations(routes, '1:20');

    for (const mode of ['FILL', 'FIT', 'TILE', 'CROP']) {
        assert.equal(decorations.get(`Paint / image ${mode}`)?.code, 'BoxDecoration(\n  borderRadius: BorderRadius.circular(8),\n)', mode);
    }
});

test('Layout fixture: nested frames produce no widgets (pins current behaviour, slice 2 replaces this)', async () => {
    const {routes, document} = fixture('layout-frame.json', '1:34');
    assert.equal(document.children.length, 8);

    const code = await widgetCode(routes, '1:34');
    assert.ok(code.includes('      child: Column(\n        children: [\n        ],\n      ),'), code);
});

// Case frames analysed on their own, from their subtree in the fixture. These pin the
// container widget only: the empty children are the nested-frames defect above.
// The FILL, min/max and absolute-child cases cannot be pinned until children render.
for (const [name, container, why] of [
    ['Layout / wrap', 'Row(\n        children: [', 'layoutWrap WRAP should give a Wrap'],
    ['Layout / space-between', 'Row(\n        children: [', 'SPACE_BETWEEN and cross-axis CENTER are dropped'],
    ['Layout / plain frame (Stack)', 'Column(\n        children: [', 'overlapping children without auto layout should give a Stack'],
] as const) {
    test(`Layout fixture: "${name}" container is ${container.slice(0, container.indexOf('('))} (pins current behaviour, slice 2 replaces this)`, async () => {
        const {document} = fixture('layout-frame.json', '1:34');
        const node = document.children.find((c: any) => c.name === name);
        assert.ok(node?.children.length > 0, name);

        const code = await widgetCode(nodeRoute(node.id, node), node.id);
        assert.ok(code.includes(`      child: ${container}`), `${why}\n${code}`);
    });
}
