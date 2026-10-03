// Cached styles belong to the call: no state crosses a tool call, over stdio or HTTP.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, FILE_KEY, nodeRoute} from './helpers/offline-tool.ts';
import {httpClient, withHttpServer} from './helpers/mcp-http.ts';

const FRAME = {
    id: '40:1', name: 'Holder', type: 'FRAME', layoutMode: 'VERTICAL', cornerRadius: 4,
    fills: [{type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}}], paddingLeft: 8, paddingRight: 8, paddingTop: 8, paddingBottom: 8,
    absoluteBoundingBox: {x: 0, y: 0, width: 100, height: 100},
    children: [{id: '40:2', name: 'Label', type: 'TEXT', characters: 'Label', fills: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}],
        style: {fontFamily: 'Inter', fontSize: 16, fontWeight: 400, letterSpacing: 0, lineHeightPx: 24, lineHeightUnit: 'PIXELS'}}],
};
const ARGS = {input: FILE_KEY, nodeId: FRAME.id, exportAssets: false, userDefinedComponent: true};
const STYLE_ID = /\b(?:decoration|padding|text)[A-Z0-9][a-z0-9]{11}\b/g;

test('the same style has the same id in two separate server runs; different code never shares an id', async () => {
    const routes = nodeRoute(FRAME.id, FRAME);
    const first = await callToolOffline(routes, 'analyze_figma_component', ARGS);
    const second = await callToolOffline(routes, 'analyze_figma_component', ARGS);
    const generated = await callToolOffline(routes, 'generate_flutter_implementation', {input: FILE_KEY, nodeId: FRAME.id});

    const ids = [...new Set(first.text.match(STYLE_ID))];
    assert.ok(ids.length >= 2, `expected decoration and text styles in:\n${first.text}`);
    assert.deepEqual([...new Set(second.text.match(STYLE_ID))], ids);
    const codeById = new Map([...generated.text.matchAll(/^final (\w+) = ([^]*?);$/gm)].map(([, id, code]) => [id, code]));
    assert.ok(codeById.size >= 2, `generate defines no styles:\n${generated.text}`);
    for (const id of codeById.keys()) assert.ok(ids.includes(id), `generate's ${id} is not an id analyse printed`);
    assert.equal(new Set(codeById.values()).size, codeById.size, 'two ids share one code');
});

test('two decorations with the same Dart code but different extra fill layers get different ids', async () => {
    // Only the bottom fill is in the decoration's code; the later fills are layers the generator reads from the style.
    const layered = (id: string, top: {r: number; g: number; b: number}) =>
        ({...FRAME, id, fills: [...FRAME.fills, {type: 'SOLID', color: {...top, a: 1}}]});
    const decorationId = async (node: {id: string}) => (await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component',
        {...ARGS, nodeId: node.id})).text.match(/• decoration: (decoration\w+)/)?.[1];

    const blue = await decorationId(layered('41:1', {r: 0, g: 0, b: 1}));
    const green = await decorationId(layered('41:2', {r: 0, g: 1, b: 0}));

    assert.ok(blue && green);
    assert.notEqual(blue, green);
});

test('two HTTP clients each see only their own styles', async () => {
    await withHttpServer(nodeRoute(FRAME.id, FRAME), async (endpoint) => {
        const a = await httpClient(endpoint, 'key-a');
        const b = await httpClient(endpoint, 'key-b');

        const aFirst = await a('analyze_figma_component', ARGS);
        const bFirst = await b('analyze_figma_component', ARGS);
        const aSecond = await a('analyze_figma_component', ARGS);

        assert.match(aFirst, /\(used 1 times\)/);
        assert.doesNotMatch(bFirst, /\(used [2-9]\d* times\)/, `B's counts include A's call:\n${bFirst}`);
        assert.equal(bFirst, aFirst);
        assert.equal(aSecond, aFirst);
    });
});
