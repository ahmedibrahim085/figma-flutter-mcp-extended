// HTTP mode keeps no session: every POST is served by its own server, so clients need no initialize and share nothing.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {FILE_KEY, nodeRoute} from './helpers/offline-tool.ts';
import {httpRequest, withHttpServer} from './helpers/mcp-http.ts';

const FRAME = {
    id: '50:1', name: 'Holder', type: 'FRAME', layoutMode: 'VERTICAL',
    fills: [{type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}}],
    absoluteBoundingBox: {x: 0, y: 0, width: 100, height: 100},
    children: [],
};
const ANALYZE = {name: 'analyze_figma_component', arguments: {input: FILE_KEY, nodeId: FRAME.id, exportAssets: false, userDefinedComponent: true}};
const call = (id: number, params: object) => ({jsonrpc: '2.0', id, method: 'tools/call', params});

test('two concurrent clients call a tool with no session id and each gets its own 200', async () => {
    await withHttpServer(nodeRoute(FRAME.id, FRAME), async (endpoint) => {
        const [a, b] = await Promise.all([
            httpRequest(endpoint, 'key-a', {message: call(7, ANALYZE)}),
            httpRequest(endpoint, 'key-b', {message: call(7, ANALYZE)}),
        ]);

        assert.equal(a.status, 200);
        assert.equal(b.status, 200);
        const [aBody, bBody] = await Promise.all([a.json(), b.json()]);
        assert.equal(aBody.id, 7);
        assert.equal(bBody.id, 7);
        assert.equal(aBody.result.isError, undefined, aBody.result.content[0].text);
        assert.equal(aBody.result.content[0].text, bBody.result.content[0].text);
        assert.doesNotMatch(bBody.result.content[0].text, /\(used [2-9]\d* times\)/);
    });
});

test('tools/list needs no initialize and no response carries a session id', async () => {
    await withHttpServer({}, async (endpoint) => {
        const list = await httpRequest(endpoint, 'key-a', {message: {jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}}});
        const init = await httpRequest(endpoint, 'key-a', {message: {jsonrpc: '2.0', id: 2, method: 'initialize',
            params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'http-mode-test', version: '1.0.0'}}}});

        assert.equal(list.status, 200);
        assert.ok((await list.json()).result.tools.length > 0);
        assert.equal(init.status, 200);
        assert.equal(init.headers.get('mcp-session-id'), null);
    });
});

test('GET and DELETE answer 405: there is no session or stream to open', async () => {
    await withHttpServer({}, async (endpoint) => {
        for (const method of ['GET', 'DELETE']) {
            const response = await httpRequest(endpoint, 'key-a', {method});
            assert.equal(response.status, 405, `${method} /mcp`);
        }
    });
});

test('over HTTP a tool that writes files and gets no projectPath refuses, and writes nothing', async () => {
    await withHttpServer({}, async (endpoint, cwd) => {
        const writing: Array<[string, object]> = [
            ['extract_theme_colors', {fileId: FILE_KEY, nodeId: '1:2'}],
            ['extract_theme_typography', {fileId: FILE_KEY, nodeId: '1:2'}],
            ['export_flutter_assets', {fileId: FILE_KEY, nodeIds: ['1:2']}],
            ['export_svg_flutter_assets', {fileId: FILE_KEY, nodeIds: ['1:2']}],
            ['generate_golden_file_test', {widgetName: 'Card', widgetImportPath: 'widgets/card.dart'}],
        ];
        for (const [name, args] of writing) {
            const response = await httpRequest(endpoint, 'key-a', {message: call(1, {name, arguments: args})});
            const {result} = await response.json();
            assert.equal(result.isError, true, `${name}: ${result.content[0].text}`);
            assert.match(result.content[0].text, /server's working folder is not the client's project/, name);
        }
        assert.deepEqual(readdirSync(cwd), [], 'the server wrote into its own folder');
    });
});

test('a request with a progressToken streams progress on its own response; one without gets plain JSON', async () => {
    const slow = Object.fromEntries(Object.entries(nodeRoute(FRAME.id, FRAME)).map(([path, route]) => [path, {...route, delayMs: 2500}]));
    await withHttpServer(slow, async (endpoint) => {
        const withToken = await httpRequest(endpoint, 'key-a', {message: call(1, {...ANALYZE, _meta: {progressToken: 'p1'}})});
        const without = await httpRequest(endpoint, 'key-a', {message: call(2, ANALYZE)});

        assert.match(withToken.headers.get('content-type') ?? '', /text\/event-stream/);
        const stream = await withToken.text();
        assert.match(stream, /"method":"notifications\/progress"/);
        assert.match(stream, /"progressToken":"p1"/);
        assert.match(stream, /"result"/);
        assert.match(without.headers.get('content-type') ?? '', /application\/json/);
        assert.doesNotMatch(await without.text(), /notifications\/progress/);
    });
});
