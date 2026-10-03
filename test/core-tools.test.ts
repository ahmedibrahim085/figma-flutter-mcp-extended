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
