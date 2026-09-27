import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withServer} from './helpers/mcp-stdio.ts';
import {startFakeFigma} from './helpers/fake-figma.ts';

const FILE_KEY = 'TESTFILEKEY0000000000A';

test('ff_get_metadata reads the node tree from the configured Figma base URL', async () => {
    const figma = await startFakeFigma({
        [`/files/${FILE_KEY}/nodes`]: {
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
    });
    let reply;
    try {
        await withServer(async (server) => {
            await server.initialize();
            reply = await server.request('tools/call', {
                name: 'ff_get_metadata',
                arguments: {fileKey: FILE_KEY, nodeId: '1:2', depth: 2},
            });
        }, {env: {FIGMA_API_BASE_URL: figma.baseUrl}});
    } finally {
        await figma.close();
    }

    const text = (reply as any).result.content[0].text as string;
    assert.match(text, /Checkout Card/);
    assert.match(text, /Pay button/);
    assert.deepEqual(
        figma.requests.map((r) => ({method: r.method, path: r.path, query: r.query})),
        [{method: 'GET', path: `/files/${FILE_KEY}/nodes`, query: {ids: '1:2', depth: '2'}}],
    );
    assert.equal(figma.requests[0].headers['x-figma-token'], 'test-key');
});

test('Flutter tools reach Figma through the same configured base URL', async () => {
    const figma = await startFakeFigma({
        [`/files/${FILE_KEY}/nodes`]: {
            body: {
                nodes: {
                    '5:1': {
                        document: {
                            id: '5:1',
                            name: 'Promo Banner',
                            type: 'COMPONENT',
                            absoluteBoundingBox: {x: 0, y: 0, width: 300, height: 80},
                            children: [],
                        },
                    },
                },
            },
        },
    });
    let reply;
    try {
        await withServer(async (server) => {
            await server.initialize();
            reply = await server.request('tools/call', {
                name: 'inspect_component_structure',
                arguments: {input: FILE_KEY, nodeId: '5:1'},
            });
        }, {env: {FIGMA_API_BASE_URL: figma.baseUrl}});
    } finally {
        await figma.close();
    }

    assert.match((reply as any).result.content[0].text as string, /Promo Banner/);
    assert.ok(figma.requests.length > 0, 'the tool must have called the fake Figma server');
    assert.ok(figma.requests.every((r) => r.path === `/files/${FILE_KEY}/nodes`),
        `unexpected requests: ${JSON.stringify(figma.requests.map((r) => r.path))}`);
});

test('without FIGMA_API_BASE_URL the real Figma API is used', async () => {
    const {figmaApiBaseUrl} = await import('../dist/services/figma.js');
    const saved = process.env.FIGMA_API_BASE_URL;
    delete process.env.FIGMA_API_BASE_URL;
    try {
        assert.equal(figmaApiBaseUrl(), 'https://api.figma.com/v1');
    } finally {
        if (saved !== undefined) process.env.FIGMA_API_BASE_URL = saved;
    }
});
