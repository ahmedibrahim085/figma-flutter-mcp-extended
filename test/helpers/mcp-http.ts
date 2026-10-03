// Spawns the built server in --http mode and speaks MCP JSON-RPC to it over POST /mcp, the way a remote client does.
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startFakeFigma, type FakeRoutes} from './fake-figma.ts';
import {builtCliPath} from './mcp-stdio.ts';

/** One `--http` server on a free port, with Figma replaced by the fake serving `routes`; `body` gets its MCP endpoint and its working folder. */
export async function withHttpServer(routes: FakeRoutes, body: (endpoint: string, cwd: string) => Promise<void>) {
    const figma = await startFakeFigma(routes);
    const port = await new Promise<number>((resolve) => {
        const probe = createServer().listen(0, () => {
            const {port} = probe.address() as {port: number};
            probe.close(() => resolve(port));
        });
    });
    const cwd = mkdtempSync(join(tmpdir(), 'mcp-http-'));
    const child = spawn(process.execPath, [builtCliPath(), '--http', `--port=${port}`], {
        cwd,
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
        await body(endpoint, cwd);
    } finally {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGKILL');
        await exited;
        await figma.close();
    }
}

/** One request with the client's Figma key, and no session id unless `session` is given. */
export function httpRequest(endpoint: string, key: string, init: {method?: string; message?: object; session?: string} = {}) {
    return fetch(endpoint, {
        method: init.method ?? 'POST',
        headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-figma-api-key': key,
            ...(init.session ? {'mcp-session-id': init.session} : {})},
        body: init.message ? JSON.stringify(init.message) : undefined,
    });
}

/** An MCP client over HTTP with its own Figma key; returns the text of each tool call. */
export async function httpClient(endpoint: string, key: string) {
    let session: string | undefined;
    let nextId = 1;
    const post = async (message: object) => {
        const response = await httpRequest(endpoint, key, {message, session});
        session ??= response.headers.get('mcp-session-id') ?? undefined;
        const text = await response.text();
        return text ? JSON.parse(text) : undefined;
    };
    await post({jsonrpc: '2.0', id: nextId++, method: 'initialize',
        params: {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'http-test', version: '1.0.0'}}});
    await post({jsonrpc: '2.0', method: 'notifications/initialized', params: {}});
    return async (tool: string, args: object): Promise<string> => {
        const reply = await post({jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: {name: tool, arguments: args}});
        return reply.result.content[0].text;
    };
}
