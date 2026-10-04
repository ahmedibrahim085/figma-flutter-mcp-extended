import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withServer} from './helpers/mcp-stdio.ts';
import {callToolOffline, FILE_KEY} from './helpers/offline-tool.ts';
import type {FakeRoutes} from './helpers/fake-figma.ts';

const frame = (id: string, extra: object = {}) => ({id, name: `Frame ${id}`, type: 'FRAME', children: [], ...extra});

/** Answers `/nodes` for one node, whichever query the tool sends. */
function nodesRoute(query: string, document: object): FakeRoutes {
    return {[`/files/${FILE_KEY}/nodes?${query}`]: {body: {nodes: {'1:1': {document}}}}};
}

const DESIGN_CONTEXT_QUERY = 'ids=1:1';

test('depth reaches Figma exactly as given by both tree tools', async () => {
    const metadata = await callToolOffline(nodesRoute('ids=1:1&depth=20', frame('1:1')),
        'ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1', depth: 20});
    assert.deepEqual(metadata.requests.map((r) => r.query), [{ids: '1:1', depth: '20'}]);

    const context = await callToolOffline(nodesRoute(`${DESIGN_CONTEXT_QUERY}&depth=20`, frame('1:1')),
        'ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1', depth: 20});
    assert.deepEqual(context.requests.map((r) => r.query), [{ids: '1:1', depth: '20'}]);
});

test('without depth no depth is sent, so Figma returns every level', async () => {
    const metadata = await callToolOffline(nodesRoute('ids=1:1', frame('1:1')),
        'ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1'});
    assert.deepEqual(metadata.requests.map((r) => r.query), [{ids: '1:1'}]);

    const context = await callToolOffline(nodesRoute(DESIGN_CONTEXT_QUERY, frame('1:1')),
        'ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1'});
    assert.deepEqual(context.requests.map((r) => r.query), [{ids: '1:1'}]);
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

test('ff_get_screenshot defaults to scale 1, one pixel per Figma unit', async () => {
    const {requests, isError} = await callToolOffline((baseUrl) => ({
        [`/images/${FILE_KEY}?ids=1:1&format=png&scale=1`]: {body: {images: {'1:1': `${baseUrl}/render/1`}}},
        '/render/1': {body: Buffer.from('png-bytes')},
    }), 'ff_get_screenshot', {fileKey: FILE_KEY, nodeId: '1:1'});
    assert.deepEqual(requests[0].query, {ids: '1:1', format: 'png', scale: '1'});
    assert.equal(isError, false);
});

test('ff_get_screenshot with useAbsoluteBounds asks Figma for the node\'s full box, not its cropped render bounds', async () => {
    const {requests, isError} = await callToolOffline((baseUrl) => ({
        [`/images/${FILE_KEY}?ids=1:1&format=png&scale=1&use_absolute_bounds=true`]: {body: {images: {'1:1': `${baseUrl}/render/1`}}},
        '/render/1': {body: Buffer.from('png-bytes')},
    }), 'ff_get_screenshot', {fileKey: FILE_KEY, nodeId: '1:1', useAbsoluteBounds: true});
    assert.deepEqual(requests[0].query, {ids: '1:1', format: 'png', scale: '1', use_absolute_bounds: 'true'});
    assert.equal(isError, false);
});

test('ff_get_screenshot sends no use_absolute_bounds when the argument is false', async () => {
    const {requests} = await callToolOffline((baseUrl) => ({
        [`/images/${FILE_KEY}?ids=1:1&format=png&scale=1`]: {body: {images: {'1:1': `${baseUrl}/render/1`}}},
        '/render/1': {body: Buffer.from('png-bytes')},
    }), 'ff_get_screenshot', {fileKey: FILE_KEY, nodeId: '1:1', useAbsoluteBounds: false});
    assert.deepEqual(requests[0].query, {ids: '1:1', format: 'png', scale: '1'});
});

// ── response budget ──────────────────────────────────────────

const BUDGET = 100000;
const wideNode = (id: string, extra: object = {}) =>
    frame(id, {absoluteBoundingBox: {x: 0, y: 0, width: 390, height: 44}, ...extra});

/** Every node id under `node`, itself included, in document order. */
const idsOf = (node: any): string[] => [node.id, ...(node.children ?? []).flatMap(idsOf)];
const idsInSummary = (node: any): string[] => [node.id, ...(Array.isArray(node.children) ? node.children : []).flatMap(idsInSummary)];

const TREE_TOOLS = [
    {tool: 'ff_get_metadata', query: 'ids=1:1', treeKey: 'nodeTree', framesKey: 'topLevelFrames'},
    {tool: 'ff_get_design_context', query: DESIGN_CONTEXT_QUERY, treeKey: 'tree', framesKey: 'frames'},
];

for (const {tool, query, treeKey, framesKey} of TREE_TOOLS) {
    test(`${tool}: 1500 children over the budget stay valid JSON and list the omitted ids`, async () => {
        const children = Array.from({length: 1500}, (_, i) => wideNode(`2:${i}`));
        const {text} = await callToolOffline(nodesRoute(query, wideNode('1:1', {children})),
            tool, {fileKey: FILE_KEY, nodeId: '1:1'});

        const out = JSON.parse(text);
        assert.ok(text.length <= BUDGET, `response is ${text.length} characters`);
        assert.equal(out.truncated, true);
        const kept = out[treeKey].children.map((c: any) => c.id);
        assert.ok(kept.length > 0 && kept.length < 1500, `kept ${kept.length}`);
        // Document order: the nodes kept are the first ones, the omitted ids are the rest, each once.
        assert.deepEqual([...kept, ...out.omittedNodeIds], children.map((c) => c.id));
        assert.equal(out[treeKey].childCount, 1500);
        // The frames list covers only what the response includes.
        assert.deepEqual(out[framesKey].map((f: any) => f.id), ['1:1', ...kept]);
    });

    test(`${tool}: the cut falls on whole nodes, and omitted ids are the roots of omitted subtrees`, async () => {
        const branch = (id: string) => wideNode(id, {children: Array.from({length: 700}, (_, i) => wideNode(`${id}.${i}`))});
        const document = wideNode('1:1', {children: [branch('3:1'), branch('3:2'), branch('3:3')]});
        const {text} = await callToolOffline(nodesRoute(query, document), tool, {fileKey: FILE_KEY, nodeId: '1:1'});

        const out = JSON.parse(text);
        assert.ok(text.length <= BUDGET, `response is ${text.length} characters`);
        assert.equal(out.truncated, true);
        const kept = idsInSummary(out[treeKey]);
        const omitted: string[] = out.omittedNodeIds;
        const ancestors = (id: string) => id.split('.').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('.')).concat(['1:1']);
        for (const id of idsOf(document)) {
            const inTree = kept.includes(id);
            const underOmitted = omitted.some((o) => o === id || id.startsWith(`${o}.`));
            assert.ok(inTree !== underOmitted, `${id}: in tree ${inTree}, under an omitted root ${underOmitted}`);
        }
        for (const id of omitted) {
            assert.ok(!ancestors(id).some((a) => omitted.includes(a) && a !== id), `${id} lies under another omitted id`);
            assert.ok(kept.includes(ancestors(id)[ancestors(id).length - 2] ?? '1:1'), `${id} has a parent that was cut`);
        }
    });

    test(`${tool}: a response inside the budget has no truncated or omittedNodeIds`, async () => {
        const document = wideNode('1:1', {children: [wideNode('2:1'), wideNode('2:2')]});
        const {text} = await callToolOffline(nodesRoute(query, document), tool, {fileKey: FILE_KEY, nodeId: '1:1'});
        const out = JSON.parse(text);
        assert.equal('truncated' in out, false);
        assert.equal('omittedNodeIds' in out, false);
    });

    test(`${tool}: tools/list declares the budget to the client`, async () => {
        await withServer(async (server) => {
            await server.initialize();
            const list: any = await server.request('tools/list');
            const entry = list.result.tools.find((t: any) => t.name === tool);
            assert.equal(entry._meta['anthropic/maxResultSizeChars'], BUDGET);
        });
    });
}

test('ff_get_variable_defs: 2000 variables over the budget stay valid JSON and list the omitted ids', async () => {
    const variables = Array.from({length: 2000}, (_, i) => variable(`V:${i}`, i % 2 ? 'VC:b' : 'VC:a'));
    const {text} = await callToolOffline(
        variablesRoute(variables, [collection('VC:a', 'Colours'), collection('VC:b', 'Spacing')]),
        'ff_get_variable_defs', {fileKey: FILE_KEY});

    const out = JSON.parse(text);
    assert.ok(text.length <= BUDGET, `response is ${text.length} characters`);
    assert.equal(out.truncated, true);
    const listed = Object.values<any>(out.collections).flatMap((c) => c.variables.map((v: any) => v.id));
    assert.ok(listed.length > 0 && listed.length < 2000, `listed ${listed.length}`);
    assert.equal(out.variableCount, listed.length);
    // Each variable is listed or omitted, once, and the omitted ones are the last in response order.
    assert.deepEqual([...listed].sort(), variables.map((v) => v.id).filter((id) => !out.omittedVariableIds.includes(id)).sort());
    assert.deepEqual(out.omittedVariableIds, variables.slice(listed.length).map((v) => v.id));
    assert.equal(new Set([...listed, ...out.omittedVariableIds]).size, 2000);
});

test('ff_get_variable_defs: a response inside the budget has no truncated or omittedVariableIds', async () => {
    const {text} = await callToolOffline(variablesRoute([variable('V:1', 'VC:a')], [collection('VC:a', 'Colours')]),
        'ff_get_variable_defs', {fileKey: FILE_KEY});
    const out = JSON.parse(text);
    assert.equal('truncated' in out, false);
    assert.equal('omittedVariableIds' in out, false);
});

test('ff_get_variable_defs: tools/list declares the budget to the client', async () => {
    await withServer(async (server) => {
        await server.initialize();
        const list: any = await server.request('tools/list');
        const entry = list.result.tools.find((t: any) => t.name === 'ff_get_variable_defs');
        assert.equal(entry._meta['anthropic/maxResultSizeChars'], BUDGET);
    });
});

// The floor of the cut: the root alone. Decision 21: text is never cut, so a root whose own
// text is over the budget is returned whole, over the budget, as valid JSON.
for (const {tool, query, treeKey} of TREE_TOOLS) {
    test(`${tool}: children that cannot fit are all omitted and the root is kept`, async () => {
        const children = ['2:1', '2:2', '2:3'].map((id) => wideNode(id, {children: [], type: 'TEXT', characters: 'x'.repeat(BUDGET + 1)}));
        const {text} = await callToolOffline(nodesRoute(query, wideNode('1:1', {children})),
            tool, {fileKey: FILE_KEY, nodeId: '1:1'});

        const out = JSON.parse(text);
        assert.ok(text.length <= BUDGET, `response is ${text.length} characters`);
        assert.equal(out[treeKey].id, '1:1');
        assert.deepEqual(out[treeKey].children, []);
        assert.equal(out.truncated, true);
        assert.deepEqual(out.omittedNodeIds, ['2:1', '2:2', '2:3']);
    });

    test(`${tool}: a root whose own text is over the budget is returned whole (regression pin, decision 21)`, async () => {
        const long = 'y'.repeat(BUDGET + 1);
        const {text} = await callToolOffline(nodesRoute(query, wideNode('1:1', {type: 'TEXT', characters: long})),
            tool, {fileKey: FILE_KEY, nodeId: '1:1'});

        const out = JSON.parse(text);
        assert.ok(text.length > BUDGET);
        assert.equal(out[treeKey].text, long);
        assert.equal('truncated' in out, false);
    });
}

// ── compact JSON (register B3.81) ────────────────────────────

/** A JSON text with no whitespace outside strings: parsing and printing it again gives the same characters. */
const isCompact = (text: string) => text === JSON.stringify(JSON.parse(text));

test('the four JSON tools reply in compact JSON, without indentation or line breaks', async () => {
    const tree = frame('1:1', {absoluteBoundingBox: {x: 0, y: 0, width: 390, height: 44}, children: [frame('1:2')]});
    const metadata = await callToolOffline(nodesRoute('ids=1:1', tree), 'ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:1'});
    const context = await callToolOffline(nodesRoute(DESIGN_CONTEXT_QUERY, tree), 'ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:1'});
    const variables = await callToolOffline(variablesRoute([variable('V:1', 'VC:a')], [collection('VC:a', 'Colours')]), 'ff_get_variable_defs', {fileKey: FILE_KEY});
    const whoami = await callToolOffline({'/me': {body: {id: '1', handle: 'h', email: 'e@x', img_url: 'u'}}}, 'ff_whoami', {});

    for (const [tool, {text}] of Object.entries({ff_get_metadata: metadata, ff_get_design_context: context, ff_get_variable_defs: variables, ff_whoami: whoami})) {
        assert.ok(isCompact(text), `${tool} replied with whitespace: ${text.slice(0, 80)}`);
    }
});

for (const {tool, query, treeKey} of TREE_TOOLS) {
    test(`${tool}: compact JSON keeps more than 400 of 1500 children inside the budget (pretty JSON kept 215)`, async () => {
        // A kept child costs about 120 characters in the tree plus about 75 in the frames list, an omitted id about 9:
        // (100000 - 13500) / (195 - 9) is about 465 children.
        const children = Array.from({length: 1500}, (_, i) => wideNode(`2:${i}`));
        const {text} = await callToolOffline(nodesRoute(query, wideNode('1:1', {children})), tool, {fileKey: FILE_KEY, nodeId: '1:1'});

        const out = JSON.parse(text);
        assert.ok(text.length <= BUDGET, `response is ${text.length} characters`);
        assert.ok(out[treeKey].children.length > 400, `kept ${out[treeKey].children.length}`);
        assert.deepEqual([...out[treeKey].children.map((c: any) => c.id), ...out.omittedNodeIds], children.map((c) => c.id));
    });
}
