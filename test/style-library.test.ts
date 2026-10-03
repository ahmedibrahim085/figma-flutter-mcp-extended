// Cached styles belong to the call: no state crosses a tool call, over stdio or HTTP.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {callToolOffline, FILE_KEY, nodeRoute} from './helpers/offline-tool.ts';
import {startFakeFigma} from './helpers/fake-figma.ts';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
const FRAME = {
    id: '40:1', name: 'Holder', type: 'FRAME', layoutMode: 'VERTICAL', cornerRadius: 4,
    fills: [{type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}}], paddingLeft: 8, paddingRight: 8, paddingTop: 8, paddingBottom: 8,
    absoluteBoundingBox: {x: 0, y: 0, width: 100, height: 100},
    children: [{id: '40:2', name: 'Label', type: 'TEXT', characters: 'Label', fills: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}],
        style: {fontFamily: 'Inter', fontSize: 16, fontWeight: 400, letterSpacing: 0, lineHeightPx: 24, lineHeightUnit: 'PIXELS'}}],
};
const ARGS = {input: FILE_KEY, nodeId: FRAME.id, exportAssets: false, userDefinedComponent: true};
const STYLE_ID = /\b(?:decoration|padding|text)[A-Z0-9][a-z0-9]{11}\b/g;

test('the same style has the same id in two separate server runs; different code never shares an id', async () => {
    const routes = nodeRoute(FRAME.id, FRAME);
    const first = await callToolOffline(routes, 'analyze_figma_component', ARGS);
    const second = await callToolOffline(routes, 'analyze_figma_component', ARGS);
    const generated = await callToolOffline(routes, 'generate_flutter_implementation', {input: FILE_KEY, nodeId: FRAME.id});

    const ids = [...new Set(first.text.match(STYLE_ID))];
    assert.ok(ids.length >= 2, `expected decoration and text styles in:\n${first.text}`);
    assert.deepEqual([...new Set(second.text.match(STYLE_ID))], ids);
    const codeById = new Map([...generated.text.matchAll(/^final (\w+) = ([^]*?);$/gm)].map(([, id, code]) => [id, code]));
    assert.ok(codeById.size >= 2, `generate defines no styles:\n${generated.text}`);
    for (const id of codeById.keys()) assert.ok(ids.includes(id), `generate's ${id} is not an id analyse printed`);
    assert.equal(new Set(codeById.values()).size, codeById.size, 'two ids share one code');
});

test('two decorations with the same Dart code but different extra fill layers get different ids', async () => {
    // Only the bottom fill is in the decoration's code; the later fills are layers the generator reads from the style.
    const layered = (id: string, top: {r: number; g: number; b: number}) =>
        ({...FRAME, id, fills: [...FRAME.fills, {type: 'SOLID', color: {...top, a: 1}}]});
    const decorationId = async (node: {id: string}) => (await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component',
        {...ARGS, nodeId: node.id})).text.match(/• decoration: (decoration\w+)/)?.[1];

    const blue = await decorationId(layered('41:1', {r: 0, g: 0, b: 1}));
    const green = await decorationId(layered('41:2', {r: 0, g: 1, b: 0}));

    assert.ok(blue && green);
    assert.notEqual(blue, green);
});

/** One `--http` server on a free port, with Figma replaced by the fake; `body` gets its MCP endpoint. */
async function withHttpServer(body: (endpoint: string) => Promise<void>) {
    const figma = await startFakeFigma(nodeRoute(FRAME.id, FRAME));
    const port = await new Promise<number>((resolve) => {
        const probe = createServer().listen(0, () => {
            const {port} = probe.address() as {port: number};
            probe.close(() => resolve(port));
        });
    });
    const child = spawn(process.execPath, [CLI, '--http', `--port=${port}`], {
        cwd: mkdtempSync(join(tmpdir(), 'mcp-http-')),
        env: {PATH: process.env.PATH, FIGMA_API_KEY: 'test-key', FIGMA_API_BASE_URL: figma.baseUrl},
        stdio: 'ignore',
    });
    try {
        const endpoint = `http://127.0.0.1:${port}/mcp`;
        for (let attempt = 0; ; attempt++) {
            try { await fetch(endpoint, {method: 'POST'}); break; } catch (error) {
                if (attempt >= 50) throw error;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        await body(endpoint);
    } finally {
        child.kill('SIGKILL');
        await figma.close();
    }
}

/** An MCP client session over HTTP with its own Figma key; returns the text of each tool call. */
async function httpClient(endpoint: string, key: string) {
    let session: string | undefined;
    let nextId = 1;
    const post = async (message: object) => {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-figma-api-key': key,
                ...(session ? {'mcp-session-id': session} : {})},
            body: JSON.stringify(message),
        });
        session ??= response.headers.get('mcp-session-id') ?? undefined;
        const text = await response.text();
        return text ? JSON.parse(text) : undefined;
    };
    await post({jsonrpc: '2.0', id: nextId++, method: 'initialize',
        params: {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'style-library-test', version: '1.0.0'}}});
    await post({jsonrpc: '2.0', method: 'notifications/initialized', params: {}});
    return async (tool: string, args: object): Promise<string> => {
        const reply = await post({jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: {name: tool, arguments: args}});
        return reply.result.content[0].text;
    };
}

test('two HTTP clients each see only their own styles', async () => {
    await withHttpServer(async (endpoint) => {
        const a = await httpClient(endpoint, 'key-a');
        const b = await httpClient(endpoint, 'key-b');

        const aFirst = await a('analyze_figma_component', ARGS);
        const bFirst = await b('analyze_figma_component', ARGS);
        const aSecond = await a('analyze_figma_component', ARGS);

        assert.match(aFirst, /\(used 1 times\)/);
        assert.doesNotMatch(bFirst, /\(used [2-9]\d* times\)/, `B's counts include A's call:\n${bFirst}`);
        assert.equal(bFirst, aFirst);
        assert.equal(aSecond, aFirst);
    });
});
