// Spawns the built server in stdio mode and speaks MCP JSON-RPC to it, the way
// a consumer's MCP client does. Tests go through this seam only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const harness: {serverStartTimeoutMs: number; killGraceMs: number} =
    JSON.parse(readFileSync(new URL('./harness.json', import.meta.url), 'utf8'));

/** How long a server may take to answer `initialize`; the value and its reason are in harness.json. */
export const SERVER_START_TIMEOUT_MS = harness.serverStartTimeoutMs;

/** Set by tools/test-run.mjs: names the folder it built for this run (dist/ inside it, package.json beside it). */
export const RUN_DIR_ENV = 'FIGMA_FLUTTER_TEST_RUN_DIR';
/** Set to 1 by tools/test-run.mjs only; a test that needs the run folder can tell a run by hand from a broken wrapper. */
export const RUN_FLAG_ENV = 'FIGMA_FLUTTER_TEST_RUN';

/**
 * The built server the tests start: the folder `npm test` built for this run, so a rebuild of the
 * repo's dist/ cannot reach a running test. A run by hand has no such folder and uses the repo's
 * dist/ (run `npm run build` first).
 */
export function builtCliPath(): string {
    const runDir = process.env[RUN_DIR_ENV];
    return join(runDir ? join(runDir, 'dist') : REPO_DIST, 'cli.js');
}

// Resolved here: the server runs from an empty temp dir, where bare `tsx` would not resolve.
const TSX_LOADER = import.meta.resolve('tsx');
const BLOCK_NETWORK = new URL('./block-network.ts', import.meta.url).href;

export interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number;
    result?: any;
    error?: {code: number; message: string};
}

export interface McpStdioServer {
    /** Every non-empty line the server wrote to stdout, parsed or not. */
    stdoutLines: string[];
    /** Hosts the server tried to resolve (network is blocked); filled after exit. */
    blockedHosts: string[];
    request(method: string, params?: object): Promise<JsonRpcMessage>;
    initialize(): Promise<JsonRpcMessage>;
}

/**
 * Starts `node <built dist>/cli.js --stdio`, runs `body`, then closes stdin and asserts
 * the server exits cleanly (code 0, no signal): a crash, a non-zero exit or a
 * hang after replying fails the test. The working directory is an empty temp
 * dir so a developer's own .env is never loaded; the API key is a dummy value.
 * Network access is blocked (see block-network.ts); any attempted host fails the
 * test unless `allowNetworkAttempts` is set by a test that asserts on it.
 */
export async function withServer(
    body: (server: McpStdioServer) => Promise<void>,
    {timeoutMs = SERVER_START_TIMEOUT_MS, env = {}, allowNetworkAttempts = false}:
        {timeoutMs?: number; env?: Record<string, string>; allowNetworkAttempts?: boolean} = {}
): Promise<McpStdioServer> {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, '--import', BLOCK_NETWORK, builtCliPath(), '--stdio'], {
        cwd: mkdtempSync(join(tmpdir(), 'mcp-test-')),
        env: {PATH: process.env.PATH, FIGMA_API_KEY: 'test-key', FIGMA_CACHE: 'off', ...env},
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutLines: string[] = [];
    let stderr = '';
    let buffer = '';
    let nextId = 1;
    const pending = new Map<number, {resolve: (m: JsonRpcMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout}>();
    const exited = new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve) =>
        child.once('exit', (code, signal) => {
            for (const {reject, timer} of pending.values()) {
                clearTimeout(timer);
                reject(new Error(`server exited (code ${code}, signal ${signal}) before replying. stderr:\n${stderr}`));
            }
            pending.clear();
            resolve({code, signal});
        })
    );

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line.trim() === '') continue;
            stdoutLines.push(line);
            let message: JsonRpcMessage;
            try {
                message = JSON.parse(line);
            } catch {
                continue; // kept in stdoutLines; the protocol test asserts on it
            }
            const waiter = message.id === undefined ? undefined : pending.get(message.id);
            if (waiter) {
                clearTimeout(waiter.timer);
                pending.delete(message.id!);
                waiter.resolve(message);
            }
        }
    });

    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);

    const server: McpStdioServer = {
        stdoutLines,
        blockedHosts: [],
        request(method, params = {}) {
            const id = nextId++;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error(`no reply to ${method} within ${timeoutMs} ms. stderr:\n${stderr}`));
                }, timeoutMs);
                pending.set(id, {resolve, reject, timer});
                send({jsonrpc: '2.0', id, method, params});
            });
        },
        async initialize() {
            const reply = await server.request('initialize', {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: {name: 'figma-flutter-tests', version: '1.0.0'},
            });
            send({jsonrpc: '2.0', method: 'notifications/initialized', params: {}});
            return reply;
        },
    };

    let bodyError: unknown;
    try {
        await body(server);
    } catch (error) {
        bodyError = error;
    }

    child.stdin.end();
    const killTimer = setTimeout(() => child.kill('SIGKILL'), harness.killGraceMs);
    const exit = await exited;
    clearTimeout(killTimer);

    server.blockedHosts = [...stderr.matchAll(/^BLOCKED-NETWORK (\S+)$/gm)].map((match) => match[1]);
    if (bodyError) throw bodyError;
    if (!allowNetworkAttempts) {
        assert.deepEqual(server.blockedHosts, [], 'the server tried to reach the network');
    }
    assert.deepEqual(exit, {code: 0, signal: null},
        `server must exit cleanly when stdin closes (SIGKILL means it hung). stderr:\n${stderr}`);
    return server;
}
