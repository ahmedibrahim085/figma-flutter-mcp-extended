// Figma reads are served from a disk cache while the file's version and last_touched_at are unchanged.
// Each call runs in its own server process sharing one cache folder, so a hit proves the cache is on disk.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callToolsOffline, FILE_KEY} from './helpers/offline-tool.ts';
import type {FakeRoutes} from './helpers/fake-figma.ts';

const META = `/files/${FILE_KEY}/meta`;
const NODES = `/files/${FILE_KEY}/nodes`;
const NODE = {id: '1:1', name: 'Frame 1:1', type: 'FRAME', children: []};
const METADATA_CALL: [string, Record<string, unknown>] = ['ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1'}];

const newMeta = (version = 'v1', lastTouchedAt = '2026-01-01T00:00:00.000Z') =>
    ({body: {file: {version, last_touched_at: lastTouchedAt}}} as {status?: number; body: any});
const nodeRoutes = (meta: object): FakeRoutes => ({
    [META]: meta as any,
    [`${NODES}?ids=1:1`]: {body: {nodes: {'1:1': {document: NODE}}}},
});
const cacheEnv = () => ({FIGMA_CACHE: 'on', FIGMA_SNAPSHOT: 'off', FIGMA_CACHE_DIR: mkdtempSync(join(tmpdir(), 'figma-cache-'))});
const paths = (requests: Array<{path: string}>) => requests.map((request) => request.path);

test('a second identical call asks /meta only; a changed last_touched_at alone refetches', async () => {
    const env = cacheEnv();
    const meta = newMeta();
    const routes = nodeRoutes(meta);

    const [first] = await callToolsOffline(routes, [METADATA_CALL], env);
    const [second] = await callToolsOffline(routes, [METADATA_CALL], env);
    meta.body.file.last_touched_at = '2026-01-01T00:01:00.000Z'; // version unchanged on purpose: Figma's version is a checkpoint id
    const [third] = await callToolsOffline(routes, [METADATA_CALL], env);

    assert.deepEqual(paths(first.requests), [META, NODES]);
    assert.deepEqual(paths(second.requests), [META]);
    assert.equal(second.text, first.text);
    assert.deepEqual(paths(third.requests), [META, NODES]);
});

test('a changed version refetches too', async () => {
    const env = cacheEnv();
    const meta = newMeta();
    const routes = nodeRoutes(meta);

    await callToolsOffline(routes, [METADATA_CALL], env);
    meta.body.file.version = 'v2';
    const [after] = await callToolsOffline(routes, [METADATA_CALL], env);

    assert.deepEqual(paths(after.requests), [META, NODES]);
});

test('a caller whose key cannot open the file gets the Figma error, not the cached copy', async () => {
    const env = cacheEnv();
    const meta = newMeta();
    const routes = nodeRoutes(meta);

    await callToolsOffline(routes, [METADATA_CALL], env);
    routes[META] = {status: 403, body: {status: 403, err: 'Forbidden'}};
    const [refused] = await callToolsOffline(routes, [METADATA_CALL], env);

    assert.equal(refused.isError, true);
    assert.match(refused.text, /Figma 403/);
    assert.deepEqual(paths(refused.requests), [META]);
});

test('the cache keeps one generation per file', async () => {
    const env = cacheEnv();
    const meta = newMeta();
    const routes = nodeRoutes(meta);

    await callToolsOffline(routes, [METADATA_CALL], env);
    meta.body.file.last_touched_at = '2026-01-01T00:01:00.000Z';
    await callToolsOffline(routes, [METADATA_CALL], env);

    assert.equal(readdirSync(join(env.FIGMA_CACHE_DIR, FILE_KEY)).length, 1);
});

test('different queries of one file do not share an entry', async () => {
    const env = cacheEnv();
    const routes: FakeRoutes = {
        [META]: newMeta() as any,
        [`${NODES}?ids=1:1`]: {body: {nodes: {'1:1': {document: NODE}}}},
        [`${NODES}?ids=1:1&depth=1`]: {body: {nodes: {'1:1': {document: {...NODE, name: 'Shallow'}}}}},
    };

    await callToolsOffline(routes, [METADATA_CALL], env);
    const [shallow] = await callToolsOffline(routes, [['ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1', depth: 1}]], env);

    assert.deepEqual(paths(shallow.requests), [META, NODES]);
    assert.match(shallow.text, /Shallow/);
});

test('FIGMA_CACHE=off fetches every time and sends no /meta', async () => {
    const routes = nodeRoutes(newMeta());
    const env = {FIGMA_CACHE: 'off', FIGMA_CACHE_DIR: cacheEnv().FIGMA_CACHE_DIR};

    await callToolsOffline(routes, [METADATA_CALL], env);
    const [second] = await callToolsOffline(routes, [METADATA_CALL], env);

    assert.deepEqual(paths(second.requests), [NODES]);
});

test('image bytes are cached, not the image URL', async () => {
    const env = cacheEnv();
    const meta = newMeta();
    const png = Buffer.from('png-bytes');
    const routes = (baseUrl: string): FakeRoutes => ({
        [META]: meta as any,
        [`/images/${FILE_KEY}?ids=1:1&format=png&scale=1`]: {body: {images: {'1:1': `${baseUrl}/render/1`}}},
        '/render/1': {body: png},
    });
    const call: [string, Record<string, unknown>] = ['ff_get_screenshot', {fileKey: FILE_KEY, nodeId: '1:1'}];

    const [first] = await callToolsOffline(routes, [call], env);
    const [second] = await callToolsOffline(routes, [call], env);

    assert.deepEqual(paths(first.requests), [META, `/images/${FILE_KEY}`, '/render/1']);
    assert.deepEqual(paths(second.requests), [META]);
    assert.equal(second.isError, false);
});

test('a render URL that fails is not cached, and the next call tries again', async () => {
    const env = cacheEnv();
    const routes = (baseUrl: string): FakeRoutes => ({
        [META]: newMeta() as any,
        [`/images/${FILE_KEY}?ids=1:1&format=png&scale=1`]: {body: {images: {'1:1': `${baseUrl}/render/1`}}},
        '/render/1': {status: 500, body: 'boom'},
    });
    const call: [string, Record<string, unknown>] = ['ff_get_screenshot', {fileKey: FILE_KEY, nodeId: '1:1'}];

    await callToolsOffline(routes, [call], env);
    const [second] = await callToolsOffline(routes, [call], env);

    assert.deepEqual(paths(second.requests), [META, `/images/${FILE_KEY}`, '/render/1']);
});

test('a screenshot with useAbsoluteBounds and one without do not share a cache entry', async () => {
    const env = cacheEnv();
    const routes = (baseUrl: string): FakeRoutes => ({
        [META]: newMeta() as any,
        [`/images/${FILE_KEY}?ids=1:1&format=png&scale=1`]: {body: {images: {'1:1': `${baseUrl}/render/cropped`}}},
        [`/images/${FILE_KEY}?ids=1:1&format=png&scale=1&use_absolute_bounds=true`]: {body: {images: {'1:1': `${baseUrl}/render/full`}}},
        '/render/cropped': {body: Buffer.from('cropped-render-bounds')},
        '/render/full': {body: Buffer.from('full-box')},
    });
    const plain: [string, Record<string, unknown>] = ['ff_get_screenshot', {fileKey: FILE_KEY, nodeId: '1:1'}];
    const full: [string, Record<string, unknown>] = ['ff_get_screenshot', {fileKey: FILE_KEY, nodeId: '1:1', useAbsoluteBounds: true}];

    const [plainFirst] = await callToolsOffline(routes, [plain], env);
    const [fullFirst] = await callToolsOffline(routes, [full], env);
    const [fullSecond] = await callToolsOffline(routes, [full], env);
    const [plainSecond] = await callToolsOffline(routes, [plain], env);

    assert.deepEqual(paths(plainFirst.requests), [META, `/images/${FILE_KEY}`, '/render/cropped']);
    // The flag must miss the plain call's entry and fetch its own render.
    assert.deepEqual(paths(fullFirst.requests), [META, `/images/${FILE_KEY}`, '/render/full']);
    assert.deepEqual(fullFirst.requests[1].query.use_absolute_bounds, 'true');
    // Each is then served from its own entry.
    assert.deepEqual(paths(fullSecond.requests), [META]);
    assert.deepEqual(paths(plainSecond.requests), [META]);
});

test('ff_get_design_context reads the entry ff_get_metadata cached: both ask Figma for the same node query', async () => {
    const env = cacheEnv();
    const [metadata, context] = await callToolsOffline(nodeRoutes(newMeta()), [METADATA_CALL, ['ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1'}]], env);

    assert.deepEqual(paths(metadata.requests), [META, NODES]);
    assert.deepEqual(paths(context.requests), [META]);
});

test('with a depth, ff_get_design_context still reads the entry ff_get_metadata cached', async () => {
    const env = cacheEnv();
    const routes = {...nodeRoutes(newMeta()), [`${NODES}?ids=1:1&depth=2`]: {body: {nodes: {'1:1': {document: NODE}}}}};
    const [metadata, context] = await callToolsOffline(routes, [
        ['ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1', depth: 2}],
        ['ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1', depth: 2}],
    ], env);

    assert.deepEqual(paths(metadata.requests), [META, NODES]);
    assert.deepEqual(paths(context.requests), [META]);
});
