import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withServer} from './helpers/mcp-stdio.ts';
import {callToolOffline, callToolsOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

test('ff_get_metadata reads the node tree from the configured Figma base URL', async () => {
    const {text, requests} = await callToolOffline({
        // ff_get_metadata sends ids=1%3A2&depth=2; the fake matches decoded params in any order.
        [`/files/${FILE_KEY}/nodes?depth=2&ids=1:2`]: {
            body: {
                nodes: {
                    '1:2': {
                        document: {
                            id: '1:2',
                            name: 'Checkout Card',
                            type: 'FRAME',
                            absoluteBoundingBox: {x: 0, y: 0, width: 320, height: 180},
                            children: [{id: '1:3', name: 'Pay button', type: 'INSTANCE', children: []}],
                        },
                    },
                },
            },
        },
    }, 'ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:2', depth: 2});

    assert.match(text, /Checkout Card/);
    assert.match(text, /Pay button/);
    assert.deepEqual(
        requests.map((r) => ({method: r.method, path: r.path, query: r.query})),
        [{method: 'GET', path: `/files/${FILE_KEY}/nodes`, query: {ids: '1:2', depth: '2'}}],
    );
    assert.equal(requests[0].headers['x-figma-token'], 'test-key');
});

test('Flutter tools reach Figma through the same configured base URL', async () => {
    const {text, requests} = await callToolOffline(nodeRoute('5:1', {
        id: '5:1',
        name: 'Promo Banner',
        type: 'COMPONENT',
        absoluteBoundingBox: {x: 0, y: 0, width: 300, height: 80},
        children: [],
    }), 'inspect_component_structure', {input: FILE_KEY, nodeId: '5:1'});

    assert.match(text, /Promo Banner/);
    assert.deepEqual(
        requests.map((r) => ({method: r.method, path: r.path, query: r.query})),
        [{method: 'GET', path: `/files/${FILE_KEY}/nodes`, query: {ids: '5:1'}}],
    );
});

for (const [tool, args] of [
    ['ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:2'}],
    ['inspect_component_structure', {input: FILE_KEY, nodeId: '5:1'}],
] as const) {
    test(`without FIGMA_API_BASE_URL, ${tool} calls the real Figma API host`, async () => {
        const server = await withServer(async (s) => {
            await s.initialize();
            await s.request('tools/call', {name: tool, arguments: args});
        }, {allowNetworkAttempts: true});
        assert.ok(server.blockedHosts.length > 0, 'the tool must have tried to reach Figma');
        assert.deepEqual([...new Set(server.blockedHosts)], ['api.figma.com']);
    });
}

test('a file key of any length reaches Figma: the server does not reject it by length', async () => {
    const node = {id: '1:2', name: 'Box', type: 'FRAME', children: []};
    const [known, unknown] = await callToolsOffline(
        {'/files/SHORTKEY9/nodes?ids=1:2': {body: {nodes: {'1:2': {document: node}}}}},
        [
            ['inspect_component_structure', {input: 'SHORTKEY9', nodeId: '1:2'}],
            ['inspect_component_structure', {input: 'SHORTKEY8', nodeId: '1:2'}],
        ],
    );
    // A short key Figma knows: the client gets the node.
    assert.deepEqual(known.requests.map((r) => r.path), ['/files/SHORTKEY9/nodes']);
    assert.match(known.text, /Box/);
    // A short key Figma does not know: the answer is Figma's 404, not a length rule of our own.
    assert.deepEqual(unknown.requests.map((r) => r.path), ['/files/SHORTKEY8/nodes']);
    assert.doesNotMatch(unknown.text, /Invalid file ID length/);
    assert.match(unknown.text, /404|not found/i);
});
