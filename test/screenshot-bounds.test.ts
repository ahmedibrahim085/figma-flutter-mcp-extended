// ff_get_screenshot answers a second text block: the node's boxes from Figma and the image's pixel size read from the image itself (S8).
// Expected values are written here from the fixtures: node 1:34 of layout-frame.json is 468 x 792 at (1500, 100), and its real Figma
// PNG (fixtures/screenshots/1_34.png, captured at scale 1) is 468 x 792. The JPEG is made from that PNG with `sips -s format jpeg`
// (a JPEG from Figma's own encoder is not tested: it waits for the batched live checks).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withServer} from './helpers/mcp-stdio.ts';
import {startFakeFigma, type FakeRoutes} from './helpers/fake-figma.ts';
import {FILE_KEY} from './helpers/offline-tool.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const PNG = fixture('screenshots/1_34.png');
const JPG = fixture('screenshot-1_34.jpg');
const BOX = {x: 1500, y: 100, width: 468, height: 792};
const NODE = {id: '1:34', name: 'Layout', type: 'FRAME', absoluteBoundingBox: BOX, absoluteRenderBounds: BOX};

/** One ff_get_screenshot call against a fake Figma that renders node 1:34 to `bytes`; `node` is what /nodes answers (undefined: no route, a 404). */
async function screenshot(args: Record<string, unknown>, bytes: Buffer = PNG, node: object | undefined = NODE) {
    const figma = await startFakeFigma((baseUrl): FakeRoutes => ({
        [`/images/${FILE_KEY}`]: {body: {err: null, images: {'1:34': `${baseUrl}/render/1`}}},
        '/render/1': {body: bytes},
        ...(node ? {[`/files/${FILE_KEY}/nodes?ids=1:34`]: {body: {nodes: {'1:34': {document: node}}}}} : {}),
    }));
    let result: any;
    try {
        await withServer(async (server) => {
            await server.initialize();
            result = (await server.request('tools/call', {name: 'ff_get_screenshot', arguments: {fileKey: FILE_KEY, nodeId: '1:34', ...args}})).result;
        }, {env: {FIGMA_API_BASE_URL: figma.baseUrl}});
        return {result, requests: figma.requests};
    } finally {
        await figma.close();
    }
}

const second = (result: any) => {
    assert.equal(result.content.length, 2, `content: ${JSON.stringify(result.content).slice(0, 200)}`);
    assert.equal(result.content[1].type, 'text');
    return JSON.parse(result.content[1].text);
};

test('png: the image block, then a text block with the boxes and the size read from the PNG header', async () => {
    const {result} = await screenshot({format: 'png'});

    assert.notEqual(result.isError, true);
    assert.deepEqual(result.content[0], {type: 'image', data: PNG.toString('base64'), mimeType: 'image/png'});
    assert.deepEqual(second(result), {
        nodeId: '1:34', format: 'png', scale: 1, useAbsoluteBounds: false, imageWidth: 468, imageHeight: 792,
        absoluteBoundingBox: BOX, absoluteRenderBounds: BOX,
    });
});

test('the second block is compact JSON', async () => {
    const {result} = await screenshot({});

    assert.equal(result.content[1].text, JSON.stringify(JSON.parse(result.content[1].text)));
});

test('jpg: the size is read from the JPEG header', async () => {
    const {result} = await screenshot({format: 'jpg'}, JPG);

    assert.equal(result.content[0].mimeType, 'image/jpeg');
    const info = second(result);
    assert.deepEqual([info.format, info.imageWidth, info.imageHeight], ['jpg', 468, 792]);
});

for (const format of ['svg', 'pdf']) {
    test(`${format}: the boxes are given and no pixel size is (there is none in the file)`, async () => {
        const {result} = await screenshot({format}, Buffer.from('<svg/>'));

        const info = second(result);
        assert.equal(info.format, format);
        assert.deepEqual(info.absoluteBoundingBox, BOX);
        assert.equal('imageWidth' in info, false);
        assert.equal('imageHeight' in info, false);
    });
}

test('scale and useAbsoluteBounds are echoed; the size is what the image holds, not a computed one', async () => {
    const {result, requests} = await screenshot({scale: 2, useAbsoluteBounds: true});

    const info = second(result);
    assert.deepEqual([info.scale, info.useAbsoluteBounds], [2, true]);
    // The fake serves the 468 x 792 PNG whatever the scale: a size multiplied by the scale would read 936 x 1584.
    assert.deepEqual([info.imageWidth, info.imageHeight], [468, 792]);
    assert.equal(requests.find((r) => r.path.startsWith('/images'))!.query.scale, '2');
});

test('a hidden node keeps absoluteRenderBounds: null', async () => {
    const {result} = await screenshot({}, PNG, {...NODE, absoluteRenderBounds: null});

    const info = second(result);
    assert.equal(info.absoluteRenderBounds, null);
    assert.deepEqual(info.absoluteBoundingBox, BOX);
});

test('a failed node read keeps the image and says why in boundsError, with the size still read from the image', async () => {
    const {result} = await screenshot({}, PNG, undefined);

    assert.notEqual(result.isError, true);
    assert.equal(result.content[0].type, 'image');
    const info = second(result);
    assert.equal(info.boundsError.status, 404);
    assert.equal(typeof info.boundsError.message, 'string');
    assert.equal('absoluteBoundingBox' in info, false);
    assert.deepEqual([info.imageWidth, info.imageHeight], [468, 792]);
});

test('one node read, one image request: the size costs no Figma read', async () => {
    const {requests} = await screenshot({});

    const paths = requests.map((r) => r.path);
    assert.equal(paths.filter((p) => p === `/files/${FILE_KEY}/nodes`).length, 1, paths.join(' '));
    assert.equal(paths.filter((p) => p === `/images/${FILE_KEY}`).length, 1, paths.join(' '));
});

test('a render Figma reports as failed reads no node', async () => {
    const figma = await startFakeFigma({[`/images/${FILE_KEY}`]: {body: {err: null, images: {'1:34': null}}}});
    try {
        let result: any;
        await withServer(async (server) => {
            await server.initialize();
            result = (await server.request('tools/call', {name: 'ff_get_screenshot', arguments: {fileKey: FILE_KEY, nodeId: '1:34'}})).result;
        }, {env: {FIGMA_API_BASE_URL: figma.baseUrl}});

        assert.equal(result.isError, true);
        assert.equal(result.content.length, 1);
        assert.deepEqual(figma.requests.map((r) => r.path), [`/images/${FILE_KEY}`]);
    } finally {
        await figma.close();
    }
});
