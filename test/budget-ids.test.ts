// The response budget (100,000 characters) holds for the list of omitted ids too (register B3.137), and the cut keeps the most
// nodes that fit (register B3.142). Expected values are written here from the documented reply shape, not read from the code.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';
import type {FakeRoutes} from './helpers/fake-figma.ts';

const BUDGET = 100000;
const box = {x: 0, y: 0, width: 390, height: 44};
const frame = (id: string, extra: object = {}) => ({id, name: `Frame ${id}`, type: 'FRAME', absoluteBoundingBox: box, children: [], ...extra});
const nodesRoute = (query: string, document: any): FakeRoutes => ({[`/files/${FILE_KEY}/nodes?${query}`]: {body: {nodes: {[document.id]: {document}}}}});
// Far more children than the budget has room for, even as bare ids: about 20,000 x 9 characters.
const MANY = 20000;
const manyChildren = () => Array.from({length: MANY}, (_, i) => frame(`2:${i}`));

for (const [tool, query] of [['ff_get_metadata', 'ids=1:1'], ['ff_get_design_context', 'ids=1:1']] as const) {
    test(`${tool}: when the omitted ids alone are over the budget, the reply holds the budget and says how many were omitted`, async () => {
        const children = manyChildren();
        const {text} = await callToolOffline(nodesRoute(query, frame('1:1', {children})), tool, {fileKey: FILE_KEY, nodeId: '1:1'});

        const out = JSON.parse(text);
        assert.ok(text.length <= BUDGET, `response is ${text.length} characters`);
        assert.equal(out.truncated, true);
        const kept = (out.nodeTree ?? out.tree).children.length;
        assert.ok(kept > 0, 'some children are kept');
        assert.equal(out.omittedNodeCount, MANY - kept);
        assert.ok(out.omittedNodeIds.length > 0 && out.omittedNodeIds.length < out.omittedNodeCount, `${out.omittedNodeIds.length} ids listed`);
        // The ids listed are the first omitted ones, in document order.
        assert.deepEqual(out.omittedNodeIds, children.slice(kept, kept + out.omittedNodeIds.length).map((c) => c.id));
    });
}

test('ff_get_variable_defs: when the omitted variable ids alone are over the budget, the reply holds the budget and says how many', async () => {
    const variables = Array.from({length: MANY}, (_, i) => ({id: `V:${i}`, name: `V:${i}`, variableCollectionId: 'VC:a', resolvedType: 'FLOAT', valuesByMode: {'m:1': 4}}));
    const byId = (list: any[]) => Object.fromEntries(list.map((item) => [item.id, item]));
    const routes: FakeRoutes = {[`/files/${FILE_KEY}/variables/local`]: {body: {meta: {variables: byId(variables),
        variableCollections: byId([{id: 'VC:a', name: 'Tokens', modes: [{modeId: 'm:1', name: 'Mode 1'}], variableIds: []}])}}}};
    const {text} = await callToolOffline(routes, 'ff_get_variable_defs', {fileKey: FILE_KEY});

    const out = JSON.parse(text);
    assert.ok(text.length <= BUDGET, `response is ${text.length} characters`);
    assert.equal(out.truncated, true);
    assert.equal(out.omittedVariableCount, MANY - out.variableCount);
    assert.ok(out.omittedVariableIds.length > 0 && out.omittedVariableIds.length < out.omittedVariableCount);
    assert.deepEqual(out.omittedVariableIds, variables.slice(out.variableCount, out.variableCount + out.omittedVariableIds.length).map((v) => v.id));
});

test('inspect_frame_structure: the text report holds the budget when the omitted ids alone are over it', async () => {
    const {text} = await callToolOffline(nodeRoute('1:1', frame('1:1', {children: manyChildren()})), 'inspect_frame_structure', {input: FILE_KEY, nodeId: '1:1'});

    assert.ok(text.length <= BUDGET, `response is ${text.length} characters`);
    const kept = text.match(/\n\d+\. Frame /g)!.length;
    assert.ok(kept > 0 && kept < MANY, `${kept} children kept`);
    assert.match(text, new RegExp(`\\ntruncated: true\\nomittedNodeIds: 2:${kept}, 2:${kept + 1}, 2:${kept + 2},`));
    assert.ok(text.endsWith(`\nomittedNodeCount: ${MANY - kept}\n`), text.slice(-80));
    const listed = text.match(/\nomittedNodeIds: ([^\n]*)\n/)![1].split(', ');
    assert.ok(listed.length > 0 && listed.length < MANY - kept, `${listed.length} ids listed`);
});

// Pin: a cut whose ids fit lists them all and carries no count, so every existing reply keeps its shape.
for (const [tool, query] of [['ff_get_metadata', 'ids=1:1'], ['ff_get_design_context', 'ids=1:1']] as const) {
    test(`${tool}: a cut whose omitted ids fit lists all of them and has no omittedNodeCount`, async () => {
        const children = Array.from({length: 1500}, (_, i) => frame(`2:${i}`));
        const {text} = await callToolOffline(nodesRoute(query, frame('1:1', {children})), tool, {fileKey: FILE_KEY, nodeId: '1:1'});

        const out = JSON.parse(text);
        assert.equal(out.truncated, true);
        assert.equal('omittedNodeCount' in out, false);
        assert.ok(out.omittedNodeIds.length > 0);
    });
}

// ── B3.142: the cut keeps the most nodes that fit ────────────

let seed = 20261004;
const random = (below: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % below;

/** A random tree of `count` nodes, depth at most 4, with ids of 3 to 60 characters, names of 20 to 60 and a mix of types. */
function randomTree(count: number): any {
    let made = 0;
    const node = (depth: number): any => {
        const id = `${made++}:${'x'.repeat(random(58))}`;
        const type = ['FRAME', 'TEXT', 'RECTANGLE', 'COMPONENT'][random(4)];
        const out: any = {id, name: 'n'.repeat(20 + random(40)), type};
        if (random(2)) out.absoluteBoundingBox = {x: 0, y: 0, width: 1 + random(500), height: 1 + random(500)};
        if (type === 'TEXT') out.characters = 'copy'.repeat(random(5)) || undefined;
        if (type !== 'TEXT' && depth < 4) out.children = [];
        return out;
    };
    const root = {...node(0), type: 'FRAME', children: [] as any[]};
    const open = [root];
    while (made < count) {
        const parent = open[random(open.length)];
        const child = node(open.length > 1 ? 1 : 1);
        parent.children.push(child);
        if (child.children) open.push(child);
    }
    return root;
}

/** The documented ff_get_metadata reply for the first `limit` nodes in document order, written independently of the tool. */
function reference(root: any, limit: number, indent: number): string {
    let included = 0;
    const omitted: string[] = [];
    const frames: any[] = [];
    const summary = (n: any): any => {
        included++;
        const s: any = {id: n.id, name: n.name, type: n.type};
        if (n.absoluteBoundingBox) s.bounds = n.absoluteBoundingBox;
        if (n.characters) s.text = n.characters;
        if (['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(n.type)) frames.push({id: n.id, name: n.name, type: n.type, width: n.absoluteBoundingBox?.width, height: n.absoluteBoundingBox?.height});
        if (n.children) {
            s.childCount = n.children.length;
            s.children = [];
            for (const child of n.children) {
                if (included < limit) s.children.push(summary(child));
                else omitted.push(child.id);
            }
        }
        return s;
    };
    const nodeTree = summary(root);
    const reply: any = {fileName: FILE_KEY, nodeTree, topLevelFrames: frames, frameCount: frames.length};
    if (omitted.length > 0) {
        reply.truncated = true;
        reply.omittedNodeIds = omitted;
    }
    return JSON.stringify(reply, null, indent || undefined);
}

const countNodes = (n: any): number => 1 + (n.children ?? []).reduce((total: number, c: any) => total + countNodes(c), 0);

test('B3.142 pin: reply length never falls as more nodes are kept, and the tool keeps the most nodes that fit (15 random trees)', async () => {
    for (let round = 0; round < 15; round++) {
        const tree = randomTree(450 + random(150));
        const {text} = await callToolOffline(nodesRoute('ids=' + tree.id, tree), 'ff_get_metadata', {fileKey: FILE_KEY, nodeId: tree.id});
        const indent = text.includes('\n') ? 2 : 0;
        const total = countNodes(tree);
        let previous = 0;
        let mostThatFit = 0;
        for (let k = 1; k <= total; k++) {
            const length = reference(tree, k, indent).length;
            assert.ok(length >= previous, `round ${round}: ${k} nodes are ${length} characters, ${k - 1} were ${previous}`);
            previous = length;
            if (length <= BUDGET) mostThatFit = k;
        }
        assert.ok(mostThatFit >= 1, `round ${round}: not even the root fits`);
        assert.equal(text, reference(tree, mostThatFit, indent), `round ${round}: ${total} nodes, the most that fit is ${mostThatFit}`);
    }
});
