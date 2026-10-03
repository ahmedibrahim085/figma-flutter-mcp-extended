// ff_get_design_context asks Figma only for what its reply uses: no vector paths, no plugin data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {callToolOffline, FILE_KEY} from './helpers/offline-tool.ts';

const RED = {type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}};
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
/** Answers `/nodes` whatever the query, so one test runs unchanged against any request the tool makes. */
const anyNodes = (document: object) => ({[`/files/${FILE_KEY}/nodes`]: {body: {nodes: {'1:1': {document}}}}});

/** What Figma adds to a node when asked for `geometry=paths` and `plugin_data=shared`. */
const withExtras = (node: any): any => ({
    ...node,
    ...(node.type === 'TEXT' ? {} : {fillGeometry: [{path: 'M0 0L10 0L10 10Z', windingRule: 'NONZERO'}], strokeGeometry: [{path: 'M0 0L1 1', windingRule: 'NONZERO'}]}),
    sharedPluginData: {'com.example.plugin': {key: 'value'}},
    children: node.children?.map(withExtras),
});

const text = (id: string, i: number) => ({id, name: `T${i}`, type: 'TEXT', characters: `copy ${i}`, fills: [RED], absoluteBoundingBox: box(60, 12)});
const rect = (id: string, i: number) => ({id, name: `R${i}`, type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40, 40)});
/** A frame of about `count` nodes, eight children to a container, three levels down. */
function tree(count: number): any {
    let made = 1;
    const fill = (node: any, depth: number) => {
        for (let k = 0; k < 8 && made < count; k++) {
            made++;
            if (depth < 4 && k % 2 === 0) {
                const child = {id: `9:${made}`, name: `F${made}`, type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(300, 200), children: [] as any[]};
                node.children.push(child);
                fill(child, depth + 1);
            } else node.children.push(made % 3 ? rect(`9:${made}`, made) : text(`9:${made}`, made));
        }
    };
    const root = {id: '1:1', name: 'Root', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(375, 812), children: [] as any[]};
    fill(root, 0);
    return root;
}

test('ff_get_design_context asks Figma for the node only: no geometry, no plugin_data, depth when given', async () => {
    const plain = await callToolOffline(anyNodes(tree(5)), 'ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1'});
    const deep = await callToolOffline(anyNodes(tree(5)), 'ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1', depth: 2});

    assert.deepEqual(plain.requests.map((r) => r.query), [{ids: '1:1'}]);
    assert.deepEqual(deep.requests.map((r) => r.query), [{ids: '1:1', depth: '2'}]);
});

// Pinned from the request that asked for paths and plugin data (commit 8222242): the reply is byte for byte the same without them.
const fixture = (name: string) => {
    const [id, value] = Object.entries<any>(JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')).nodes)[0];
    return {id, document: value.document};
};
const PINNED: Array<[name: string, count: number | string, length: number, sha: string]> = [
    ['3,000-node tree', 3000, 99732, '6bbe37c3a6fb42e0'],
    ['text-frame.json', 'text-frame.json', 4136, '7803c286a625eb1c'],
    ['layout-frame.json', 'layout-frame.json', 9774, '55852603d628e50f'],
    ['paints-frame.json', 'paints-frame.json', 4002, '405912ce6a2529e5'],
    ['component-button-set.json', 'component-button-set.json', 14227, 'c4cd2ebab1d12557'],
];
for (const [name, source, length, hash] of PINNED) {
    test(`${name}: the reply is the same whether or not Figma sent vector paths and plugin data`, async () => {
        const {id, document} = typeof source === 'number' ? {id: '1:1', document: tree(source)} : fixture(source);
        const call = (doc: object) => callToolOffline({[`/files/${FILE_KEY}/nodes`]: {body: {nodes: {[id]: {document: doc}}}}}, 'ff_get_design_context', {fileKey: FILE_KEY, nodeId: id});
        const [asked, notAsked] = [await call(withExtras(document)), await call(document)];

        assert.equal(asked.text, notAsked.text);
        assert.deepEqual([notAsked.text.length, sha(notAsked.text)], [length, hash]);
    });
}
