// Spawns the built server in --http mode and speaks MCP JSON-RPC to it over POST /mcp, the way a remote client does.
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startFakeFigma, type FakeRoutes} from './fake-figma.ts';
import {builtCliPath, SERVER_START_TIMEOUT_MS} from './mcp-stdio.ts';

/**
 * One `--http` server with Figma replaced by the fake serving `routes`; `body` gets its MCP endpoint and its working folder.
 * The port is a free one the helper picked, unless `port` says otherwise (a test of a server that cannot start); `args` are more CLI arguments.
 * The server is ready when it logs that it listens: a probe request could be answered by another process that took the port.
 * A server that exits before that fails the helper with its own error text, and one that never listens fails it after
 * SERVER_START_TIMEOUT_MS, so a broken start never hangs the test run.
 */
export async function withHttpServer(routes: FakeRoutes, body: (endpoint: string, cwd: string) => Promise<void>, {port: fixedPort, args = []}: {port?: number; args?: string[]} = {}) {
    const figma = await startFakeFigma(routes);
    try {
        const port = fixedPort ?? await new Promise<number>((resolve) => {
            // The probe frees the port before the server binds it; a process that takes it in between makes the server exit with EADDRINUSE, which fails fast below.
            const probe = createServer().listen(0, () => {
                const {port} = probe.address() as {port: number};
                probe.close(() => resolve(port));
            });
        });
        const cwd = mkdtempSync(join(tmpdir(), 'mcp-http-'));
        const child = spawn(process.execPath, [builtCliPath(), '--http', `--port=${port}`, ...args], {
            cwd,
            env: {PATH: process.env.PATH, FIGMA_API_KEY: 'test-key', FIGMA_CACHE: 'off', FIGMA_API_BASE_URL: figma.baseUrl},
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        // Made at spawn: a promise made after the server exited would wait for an 'exit' event that never comes again.
        const exited = new Promise<string>((resolve) =>
            child.once('exit', (code, signal) => resolve(`the server exited (code ${code}, signal ${signal}) before it listened`)));
        const listening = new Promise<undefined>((resolve) => child.stderr.on('data', (chunk) => {
            stderr += chunk;
            if (stderr.includes(`listening on port ${port}`)) resolve(undefined);
        }));
        let timer: NodeJS.Timeout | undefined;
        const timedOut = new Promise<string>((resolve) => {
            timer = setTimeout(() => resolve(`the server did not listen within ${SERVER_START_TIMEOUT_MS} ms`), SERVER_START_TIMEOUT_MS);
        });
        const startError = await Promise.race([listening, exited, timedOut]);
        clearTimeout(timer);
        try {
            if (startError !== undefined) throw new Error(`${startError}. stderr:\n${stderr}`);
            await body(`http://127.0.0.1:${port}/mcp`, cwd);
        } finally {
            child.kill('SIGKILL');
            await exited;
        }
    } finally {
        await figma.close();
    }
}

/** One request with the client's Figma key, and no session id unless `session` is given. */
export function httpRequest(endpoint: string, key: string, init: {method?: string; message?: object; session?: string; headers?: Record<string, string>} = {}) {
    return fetch(endpoint, {
        method: init.method ?? 'POST',
        headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-figma-api-key': key,
            ...(init.session ? {'mcp-session-id': init.session} : {}), ...init.headers},
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
