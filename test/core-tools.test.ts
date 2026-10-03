import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, FILE_KEY} from './helpers/offline-tool.ts';
import type {FakeRoutes} from './helpers/fake-figma.ts';

const frame = (id: string, extra: object = {}) => ({id, name: `Frame ${id}`, type: 'FRAME', children: [], ...extra});

/** Answers `/nodes` for one node, whichever query the tool sends. */
function nodesRoute(query: string, document: object): FakeRoutes {
    return {[`/files/${FILE_KEY}/nodes?${query}`]: {body: {nodes: {'1:1': {document}}}}};
}

const DESIGN_CONTEXT_QUERY = 'ids=1:1&geometry=paths&plugin_data=shared';

test('depth reaches Figma exactly as given by both tree tools', async () => {
    const metadata = await callToolOffline(nodesRoute('ids=1:1&depth=20', frame('1:1')),
        'ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1', depth: 20});
    assert.deepEqual(metadata.requests.map((r) => r.query), [{ids: '1:1', depth: '20'}]);

    const context = await callToolOffline(nodesRoute(`${DESIGN_CONTEXT_QUERY}&depth=20`, frame('1:1')),
        'ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1', depth: 20});
    assert.deepEqual(context.requests.map((r) => r.query), [{ids: '1:1', geometry: 'paths', plugin_data: 'shared', depth: '20'}]);
});

test('without depth no depth is sent, so Figma returns every level', async () => {
    const metadata = await callToolOffline(nodesRoute('ids=1:1', frame('1:1')),
        'ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1'});
    assert.deepEqual(metadata.requests.map((r) => r.query), [{ids: '1:1'}]);

    const context = await callToolOffline(nodesRoute(DESIGN_CONTEXT_QUERY, frame('1:1')),
        'ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1'});
    assert.deepEqual(context.requests.map((r) => r.query), [{ids: '1:1', geometry: 'paths', plugin_data: 'shared'}]);
});

test('a 300-character text comes back whole from both tree tools', async () => {
    const long = `${'a'.repeat(299)}Z`;
    const document = frame('1:1', {children: [{id: '1:2', name: 'Body', type: 'TEXT', characters: long}]});

    const metadata = await callToolOffline(nodesRoute('ids=1:1', document),
        'ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1'});
    assert.equal(JSON.parse(metadata.text).nodeTree.children[0].text, long);

    const context = await callToolOffline(nodesRoute(DESIGN_CONTEXT_QUERY, document),
        'ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1'});
    assert.equal(JSON.parse(context.text).tree.children[0].text, long);
});

for (const tool of ['ff_get_metadata', 'ff_get_design_context']) {
    for (const depth of [0, -1, 2.5]) {
        test(`${tool} rejects depth ${depth} before calling Figma`, async () => {
            const {isError, text, requests} = await callToolOffline({}, tool, {fileKey: FILE_KEY, nodeId: '1:1', depth});
            assert.equal(isError, true, text);
            assert.match(text, /depth/);
            assert.deepEqual(requests, []);
        });
    }
}

const variable = (id: string, collectionId: string) =>
    ({id, name: id, variableCollectionId: collectionId, resolvedType: 'FLOAT', valuesByMode: {'m:1': 4}});
const collection = (id: string, name: string) => ({id, name, modes: [{modeId: 'm:1', name: 'Mode 1'}], variableIds: []});

function variablesRoute(variables: object[], collections: object[]): FakeRoutes {
    const byId = (list: any[]) => Object.fromEntries(list.map((item) => [item.id, item]));
    return {[`/files/${FILE_KEY}/variables/local`]: {body: {meta: {variables: byId(variables), variableCollections: byId(collections)}}}};
}

test('a variable whose collection is not in the response is still listed', async () => {
    const {text} = await callToolOffline(
        variablesRoute([variable('V:1', 'VC:known'), variable('V:2', 'VC:remote')], [collection('VC:known', 'Local')]),
        'ff_get_variable_defs', {fileKey: FILE_KEY});
    const out = JSON.parse(text);
    assert.deepEqual(Object.keys(out.collections).sort(), ['VC:known', 'VC:remote']);
    assert.deepEqual(out.collections['VC:remote'].variables.map((v: any) => v.id), ['V:2']);
    assert.equal(out.variableCount, 2);
    assert.equal(out.collectionCount, 2);
});

test('collections that share a name stay apart, keyed by id with the name inside', async () => {
    const {text} = await callToolOffline(
        variablesRoute([variable('V:a', 'VC:a'), variable('V:b', 'VC:b')], [collection('VC:a', 'Tokens'), collection('VC:b', 'Tokens')]),
        'ff_get_variable_defs', {fileKey: FILE_KEY});
    const {collections} = JSON.parse(text);
    assert.deepEqual(Object.keys(collections).sort(), ['VC:a', 'VC:b']);
    assert.equal(collections['VC:a'].name, 'Tokens');
    assert.deepEqual(collections['VC:a'].variables.map((v: any) => v.id), ['V:a']);
    assert.deepEqual(collections['VC:b'].variables.map((v: any) => v.id), ['V:b']);
    assert.deepEqual(collections['VC:a'].modes, [{id: 'm:1', name: 'Mode 1'}]);
});
