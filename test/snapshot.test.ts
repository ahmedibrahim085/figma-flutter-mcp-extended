// A file is downloaded once (GET /files/:key) and every node read of that file version is cut out of the snapshot.
// Each call runs in its own server process sharing one cache folder, so a hit proves the snapshot is on disk.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callToolsOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';
import type {FakeRoutes} from './helpers/fake-figma.ts';

const META = `/files/${FILE_KEY}/meta`;
const FILE = `/files/${FILE_KEY}`;
const NODES = `/files/${FILE_KEY}/nodes`;
const paths = (requests: Array<{path: string}>) => requests.map((request) => request.path);
const cacheEnv = (extra: Record<string, string> = {}) => ({FIGMA_CACHE: 'on', FIGMA_CACHE_DIR: mkdtempSync(join(tmpdir(), 'figma-snapshot-')), ...extra});
const newMeta = (lastTouchedAt = '2026-01-01T00:00:00.000Z') => ({body: {file: {version: 'v1', last_touched_at: lastTouchedAt}}} as {status?: number; body: any});

// ── fixtures: the committed /nodes replies, wrapped into one /files reply ────

const FIXTURES = ['alignment-frame', 'component-button-set', 'layout-frame', 'paints-frame', 'text-frame', 'theme-colours-frame', 'typography-slots-frame']
    .map((name) => {
        // Two fixtures reuse the style ids S:1..S:3 for different styles; a file holds one style per id, so one is renamed.
        const text = readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8');
        const reply = JSON.parse(name === 'typography-slots-frame' ? text.replaceAll('"S:', '"S:T') : text);
        const [id, entry] = Object.entries<any>(reply.nodes)[0];
        return {name, id, entry};
    });

/** A `/files/:key` reply: one page holding `frames`, and the file-wide maps (the union of what the fixtures' own replies carry). */
function fileReply(frames: object[], maps: {components?: object; componentSets?: object; styles?: object} = {}) {
    return {
        name: 'Snapshot test', lastModified: '2026-01-01T00:00:00Z', thumbnailUrl: '', version: 'v1', role: 'owner', editorType: 'figma', linkAccess: 'view',
        document: {id: '0:0', name: 'Document', type: 'DOCUMENT', children: [{id: '0:1', name: 'Page 1', type: 'CANVAS', children: frames}]},
        components: maps.components ?? {}, componentSets: maps.componentSets ?? {}, schemaVersion: 0, styles: maps.styles ?? {},
    };
}
const fixtureFile = () => fileReply(FIXTURES.map((f) => f.entry.document), {
    components: Object.assign({}, ...FIXTURES.map((f) => f.entry.components ?? {})),
    componentSets: Object.assign({}, ...FIXTURES.map((f) => f.entry.componentSets ?? {})),
    styles: Object.assign({}, ...FIXTURES.map((f) => f.entry.styles ?? {})),
});

const fileRoutes = (file: object, meta = newMeta()): FakeRoutes => ({[META]: meta as any, [FILE]: {body: file}});

/** Figma's `/nodes` reply for `id`: the file's own top-level fields and the node's entry. */
const nodesReply = (id: string, entry: unknown) => {
    const {name, lastModified, thumbnailUrl, version, role, editorType, linkAccess} = fileReply([]);
    return {name, lastModified, thumbnailUrl, version, role, editorType, linkAccess, nodes: {[id]: entry}};
};
const nodesRoutes = (id: string, entry: unknown): FakeRoutes => ({[META]: newMeta() as any, [`${NODES}?ids=${id}`]: {body: nodesReply(id, entry)}});

/** A `ff_get_metadata` read of `id`, as a call for callToolsOffline. */
const metadataRead = (id: string): [string, Record<string, unknown>] => ['ff_get_metadata', {fileKey: FILE_KEY, nodeId: id}];
/** The cache settings with the snapshot off: node reads go to Figma's own /nodes, the reference the snapshot must equal. */
const offEnv = () => cacheEnv({FIGMA_SNAPSHOT: 'off'});
type Call = [tool: string, args: Record<string, unknown>];
/** One call answered from a snapshot of `file`. */
const viaSnapshot = async (call: Call, file: object) => (await callToolsOffline(fileRoutes(file), [call], cacheEnv()))[0];
/** One call answered by Figma's own /nodes reply `entry` for `id`, snapshot off. */
const viaNodes = async (call: Call, id: string, entry: unknown) => (await callToolsOffline(nodesRoutes(id, entry), [call], offEnv()))[0];

// ── request counts ───────────────────────────────────────────────────────────

test('the first node read downloads the file once; later reads of that version ask /meta only; a new last_touched_at downloads again', async () => {
    const env = cacheEnv();
    const meta = newMeta();
    const routes = fileRoutes(fixtureFile(), meta);

    const [first] = await callToolsOffline(routes, [metadataRead('1:34')], env);
    const [second] = await callToolsOffline(routes, [metadataRead('1:8'), ['ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:20'}]], env);
    meta.body.file.last_touched_at = '2026-01-01T00:01:00.000Z';
    const [third] = await callToolsOffline(routes, [metadataRead('1:34')], env);

    assert.deepEqual(paths(first.requests), [META, FILE]);
    assert.equal(first.isError, false);
    assert.deepEqual(paths(second.requests), [META]);
    assert.deepEqual(paths(third.requests), [META, FILE]);
});

test('FIGMA_SNAPSHOT=off reads /nodes as before and never asks for the whole file', async () => {
    const env = offEnv();
    const {id, entry} = FIXTURES[2];
    const routes = {[META]: newMeta() as any, ...nodeRoute(id, entry.document)};

    const [result] = await callToolsOffline(routes, [['ff_get_metadata', {fileKey: FILE_KEY, nodeId: id}]], env);

    assert.deepEqual(paths(result.requests), [META, NODES]);
});

test('a depth request is read from Figma, not cut from the snapshot', async () => {
    const env = cacheEnv();
    const routes: FakeRoutes = {...fileRoutes(fixtureFile()), [`${NODES}?ids=1:34&depth=1`]: {body: {nodes: {'1:34': {document: FIXTURES[2].entry.document}}}}};

    const [result] = await callToolsOffline(routes, [['ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:34', depth: 1}]], env);

    assert.deepEqual(paths(result.requests), [META, NODES]);
});

test('a whole-file download that fails falls back to /nodes, and is not tried again by the same server', async () => {
    const [layout, paints] = [FIXTURES[2], FIXTURES[3]];
    const routes: FakeRoutes = {[META]: newMeta() as any, [FILE]: {status: 400, body: {status: 400, err: 'too large'}}, ...nodeRoute(layout.id, layout.entry.document), ...nodeRoute(paints.id, paints.entry.document)};

    const [first, second] = await callToolsOffline(routes, [metadataRead(layout.id), metadataRead(paints.id)], cacheEnv());

    assert.equal(first.isError, false);
    assert.deepEqual(paths(first.requests), [META, FILE, NODES]);
    assert.equal(second.isError, false);
    assert.deepEqual(paths(second.requests), [META, NODES]);
});

// ── identity: the snapshot gives the replies /nodes gave ────────────────────

for (const {name, id, entry} of FIXTURES) {
    for (const [tool, extra] of [
        ['ff_get_metadata', {}],
        ['ff_get_design_context', {}],
    ] as Array<[string, Record<string, unknown>]>) {
        test(`${name}: ${tool} from the snapshot is the reply /nodes gave`, async () => {
            const call: Call = [tool, {fileKey: FILE_KEY, nodeId: id, ...extra}];
            const [snap, nodes] = [await viaSnapshot(call, fixtureFile()), await viaNodes(call, id, entry)];

            assert.equal(snap.isError, false);
            assert.equal(snap.text, nodes.text);
        });
    }
}

for (const [tool, extra] of [
    ['analyze_figma_component', {exportAssets: false, userDefinedComponent: true}],
    ['analyze_frame_as_screen', {extractAssets: false}],
    ['inspect_frame_structure', {}],
    ['generate_flutter_implementation', {}],
] as Array<[string, Record<string, unknown>]>) {
    for (const {name, id, entry} of FIXTURES.filter((f) => ['component-button-set', 'layout-frame'].includes(f.name))) {
        test(`${name}: ${tool} from the snapshot is the reply /nodes gave`, async () => {
            const call: Call = [tool, {input: FILE_KEY, nodeId: id, ...extra}];
            const [snap, nodes] = [await viaSnapshot(call, fixtureFile()), await viaNodes(call, id, entry)];

            assert.equal(snap.isError, false);
            assert.equal(snap.text, nodes.text);
        });
    }
}

test('a node id the file does not hold gives the error /nodes gave', async () => {
    const call: Call = ['ff_get_design_context', {fileKey: FILE_KEY, nodeId: '9:9999'}];
    const [snap, nodes] = [await viaSnapshot(call, fixtureFile()), await viaNodes(call, '9:9999', null)];

    assert.equal(snap.isError, true);
    assert.equal(snap.text, nodes.text);
});

test('a page, and the document, are cut from the snapshot like any node', async () => {
    const file: any = fixtureFile();
    for (const id of ['0:1', '0:0']) {
        const node = id === '0:0' ? file.document : file.document.children[0];
        const [snap, nodes] = [await viaSnapshot(metadataRead(id), file), await viaNodes(metadataRead(id), id, {document: node, components: {}, componentSets: {}, schemaVersion: 0, styles: {}})];

        assert.equal(snap.text, nodes.text, id);
    }
});

// ── a large file: many top-level frames, replies over the budget ────────────

const RED = {type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}};
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
function bigFile(frames: number, perFrame: number) {
    let n = 0;
    const list = Array.from({length: frames}, (_, f) => ({
        id: `3:${++n}`, name: `Frame ${f}`, type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(375, 800),
        children: Array.from({length: perFrame}, (_, i) => i % 3
            ? {id: `3:${++n}`, name: `R${i}`, type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40, 40)}
            : {id: `3:${++n}`, name: `T${i}`, type: 'TEXT', characters: `copy ${i}`, fills: [RED], absoluteBoundingBox: box(60, 12)}),
    }));
    return {file: fileReply(list), frames: list};
}

for (const tool of ['ff_get_metadata', 'ff_get_design_context']) {
    test(`${tool}: frames of a 3,000-node file, one of them cut by the budget, equal the /nodes replies`, async () => {
        const {file, frames} = bigFile(6, 499);
        const env = cacheEnv();
        const reads = frames.map((frame): Call => [tool, {fileKey: FILE_KEY, nodeId: frame.id}]);
        const snap = await callToolsOffline(fileRoutes(file), reads, env);

        for (const [i, frame] of frames.entries()) {
            const nodes = await viaNodes(reads[i], frame.id, {document: frame, components: {}, componentSets: {}, schemaVersion: 0, styles: {}});
            assert.equal(snap[i].text, nodes.text, frame.id);
        }
        assert.match(snap[0].text, /"truncated": true/);
        assert.deepEqual(paths(snap[0].requests), [META, FILE]);
        assert.deepEqual(paths(snap[5].requests), [META]);
    });
}

test('the snapshot is written once, into the file\'s cache folder', async () => {
    const env = cacheEnv();
    await callToolsOffline(fileRoutes(fixtureFile()), [metadataRead('1:34')], env);

    const folders = readdirSync(join(env.FIGMA_CACHE_DIR, FILE_KEY));
    assert.equal(folders.length, 1);
    assert.ok(readdirSync(join(env.FIGMA_CACHE_DIR, FILE_KEY, folders[0])).length >= 2, 'the frames and their index are two entries');
});

// Figma lists a /nodes entry's maps in the order the subtree first refers to each item, children before their parent.
// Written from 7 real entries (two files); the file-wide map below is in neither the pre-order nor the post-order.
test('an entry lists its styles and components by first reference, children before their parent', async () => {
    const style = (name: string) => ({key: name, name, styleType: 'FILL', remote: false, description: ''});
    const component = (name: string) => ({key: name, name, description: '', remote: false, documentationLinks: []});
    const leaf = (id: string, extra: object) => ({id, name: id, type: 'RECTANGLE', ...extra});
    const frame = leaf('5:1', {type: 'FRAME', fillStyleId: 'S:c', children: [
        leaf('5:2', {fillStyleId: 'S:a', componentId: '5:90'}),
        leaf('5:3', {strokeStyleId: 'S:b', componentId: '5:80'}),
    ]});
    const file = fileReply([frame], {styles: {'S:b': style('b'), 'S:c': style('c'), 'S:a': style('a')}, components: {'5:90': component('x'), '5:80': component('y')}});

    const [reply] = await callToolsOffline(fileRoutes(file), [['ff_get_design_context', {fileKey: FILE_KEY, nodeId: '5:1'}]], cacheEnv());

    const out = JSON.parse(reply.text);
    assert.deepEqual(Object.keys(out.styles), ['S:a', 'S:b', 'S:c']);
    assert.deepEqual(Object.keys(out.components), ['5:90', '5:80']);
});

// ── a snapshot that cannot be read falls back to Figma ──────────────────────

test('an index whose frames entry is gone falls back to /nodes, with the same reply', async () => {
    const env = cacheEnv();
    const [layout, paints] = [FIXTURES[2], FIXTURES[3]];
    const routes: FakeRoutes = {...fileRoutes(fixtureFile()), ...nodesRoutes(paints.id, paints.entry)};
    await callToolsOffline(routes, [metadataRead(layout.id)], env);
    const folder = join(env.FIGMA_CACHE_DIR, FILE_KEY, readdirSync(join(env.FIGMA_CACHE_DIR, FILE_KEY))[0]);
    rmSync(join(folder, 'snapshot-frames')); // the entry name is the snapshot's own; the index entry stays

    const [stale] = await callToolsOffline(routes, [metadataRead(paints.id)], env);
    const nodes = await viaNodes(metadataRead(paints.id), paints.id, paints.entry);

    assert.equal(stale.isError, false);
    assert.deepEqual(paths(stale.requests), [META, NODES]);
    assert.equal(stale.text, nodes.text);
});

// ── a large file, generated here: 120,000 nodes in 1,200 frames ─────────────

test('a 120,000-node file: five nodes, one frame cut by the budget, equal the /nodes replies in both tools', async () => {
    const style = (n: number) => ({key: `key-S${n}`, name: `Style ${n}`, styleType: 'FILL', remote: false, description: ''});
    const component = (n: number) => ({key: `key-C${n}`, name: `Component ${n}`, description: '', remote: false, documentationLinks: []});
    const leaf = (id: string, i: number) => ({id, name: `Layer ${i}`, type: 'RECTANGLE', absoluteBoundingBox: box(40, 40)});
    // Frame k uses style S:(k%50) and holds one instance of component C:(k%20); its other 98 children are plain rectangles.
    const frame = (k: number) => ({
        id: `F:${k}`, name: `Frame ${k}`, type: 'FRAME', layoutMode: 'VERTICAL', fillStyleId: `S:${k % 50}`, absoluteBoundingBox: box(375, 800),
        children: [{id: `F:${k}:i`, name: 'Instance', type: 'INSTANCE', componentId: `C:${k % 20}`, absoluteBoundingBox: box(40, 40)},
            ...Array.from({length: 98}, (_, i) => leaf(`F:${k}:${i}`, i))],
    });
    const big = {id: 'F:big', name: 'Big', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: box(375, 90000), children: Array.from({length: 3000}, (_, i) => leaf(`F:big:${i}`, i))};
    const frames = [...Array.from({length: 1200}, (_, k) => frame(k)), big];
    const file = fileReply(frames, {
        styles: Object.fromEntries(Array.from({length: 50}, (_, n) => [`S:${n}`, style(n)])),
        components: Object.fromEntries(Array.from({length: 20}, (_, n) => [`C:${n}`, component(n)])),
    });
    const count = (node: any): number => 1 + (node.children ?? []).reduce((sum: number, child: any) => sum + count(child), 0);
    assert.ok(frames.reduce((sum, f) => sum + count(f), 0) >= 120000);

    // Written from the construction above, not from the code under test: what Figma's /nodes sends for each node.
    const entry = (document: any, k?: number) => ({
        document, schemaVersion: 0, componentSets: {},
        components: k === undefined ? {} : {[`C:${k % 20}`]: component(k % 20)},
        styles: k === undefined ? {} : {[`S:${k % 50}`]: style(k % 50)},
    });
    const wanted: Array<[string, any, number | undefined]> = [
        ['F:0', frames[0], 0], ['F:600', frames[600], 600], ['F:1199', frames[1199], 1199],
        ['F:700:42', frames[700].children[43], undefined], ['F:big', big, undefined],
    ];
    for (const tool of ['ff_get_design_context', 'ff_get_metadata']) {
        const calls = wanted.map(([id]): Call => [tool, {fileKey: FILE_KEY, nodeId: id}]);
        const snap = await callToolsOffline(fileRoutes(file), calls, cacheEnv());
        const nodesRoutesAll: FakeRoutes = {[META]: newMeta() as any};
        for (const [id, document, k] of wanted) Object.assign(nodesRoutesAll, nodesRoutes(id, entry(document, k)));
        const nodes = await callToolsOffline(nodesRoutesAll, calls, offEnv());

        for (const [i, [id]] of wanted.entries()) {
            assert.equal(snap[i].isError, false, `${tool} ${id}`);
            assert.equal(snap[i].text, nodes[i].text, `${tool} ${id}`);
        }
        assert.match(snap[4].text, /"truncated": true/, `${tool}: the big frame is cut by the budget`);
        assert.deepEqual(paths(snap[0].requests), [META, FILE]);
        assert.deepEqual(paths(snap[4].requests), [META]);
    }
});
