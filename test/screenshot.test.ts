// ff_get_screenshot: the format is the enum Figma documents, a PDF is an embedded resource (not an image block), and a render Figma reports as failed is an error.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withServer} from './helpers/mcp-stdio.ts';
import {startFakeFigma, type FakeRoutes} from './helpers/fake-figma.ts';
import {FILE_KEY} from './helpers/offline-tool.ts';

const BYTES = Buffer.from('rendered-bytes');

/** One ff_get_screenshot call against a fake Figma that renders node 1:1 to BYTES (or to null); returns the whole MCP result and the requests Figma saw. */
async function screenshot(args: Record<string, unknown>, rendered: 'bytes' | 'null' = 'bytes') {
    const figma = await startFakeFigma((baseUrl): FakeRoutes => ({
        [`/images/${FILE_KEY}`]: {body: {err: null, images: {'1:1': rendered === 'bytes' ? `${baseUrl}/render/1` : null}}},
        '/render/1': {body: BYTES},
    }));
    let result: any;
    try {
        await withServer(async (server) => {
            await server.initialize();
            result = (await server.request('tools/call', {name: 'ff_get_screenshot', arguments: {fileKey: FILE_KEY, nodeId: '1:1', ...args}})).result;
        }, {env: {FIGMA_API_BASE_URL: figma.baseUrl}});
        return {result, requests: figma.requests};
    } finally {
        await figma.close();
    }
}

test('format is the enum Figma documents: png, jpg, svg, pdf', async () => {
    let tools: any[] = [];
    await withServer(async (server) => {
        await server.initialize();
        tools = ((await server.request('tools/list')).result as any).tools;
    });

    const format = tools.find((tool) => tool.name === 'ff_get_screenshot').inputSchema.properties.format;
    assert.deepEqual(format.enum, ['png', 'jpg', 'svg', 'pdf']);
});

test('a format outside the enum is refused before any Figma call', async () => {
    const {result, requests} = await screenshot({format: 'webp'});

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /format/);
    assert.deepEqual(requests, []);
});

for (const [format, mimeType] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['svg', 'image/svg+xml']]) {
    test(`${format} is one image block of ${mimeType}`, async () => {
        const {result} = await screenshot({format});

        assert.notEqual(result.isError, true);
        assert.deepEqual(result.content, [{type: 'image', data: BYTES.toString('base64'), mimeType}]);
    });
}

test('a PDF is an embedded resource of application/pdf, not an image block', async () => {
    const {result} = await screenshot({format: 'pdf'});

    assert.notEqual(result.isError, true);
    assert.equal(result.content.length, 1);
    const [block] = result.content;
    assert.equal(block.type, 'resource');
    assert.equal(block.resource.mimeType, 'application/pdf');
    assert.equal(block.resource.blob, BYTES.toString('base64'));
    const uri = new URL(block.resource.uri);
    assert.equal(uri.protocol, 'https:');
    assert.ok(uri.pathname.includes(FILE_KEY), block.resource.uri);
    assert.equal(uri.searchParams.get('node-id'), '1:1');
});

test('a render Figma reports as failed (null in /images) is an error that says so', async () => {
    const {result} = await screenshot({}, 'null');

    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'Figma could not render node 1:1: rendering of that specific node has failed.');
});
