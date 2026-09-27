// Spawns the built server in stdio mode and speaks MCP JSON-RPC to it, the way
// a consumer's MCP client does. Tests go through this seam only.
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli.js');

/**
 * Starts `node dist/cli.js --stdio`. The working directory is an empty temp dir
 * so a developer's own .env is never loaded; the API key is a dummy value.
 */
export function startServer({env = {}, timeoutMs = 15000} = {}) {
    const child = spawn(process.execPath, [CLI, '--stdio'], {
        cwd: mkdtempSync(join(tmpdir(), 'mcp-test-')),
        env: {PATH: process.env.PATH, FIGMA_API_KEY: 'test-key', ...env},
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutLines = [];
    let stderr = '';
    let buffer = '';
    let nextId = 1;
    const pending = new Map();
    let exit = null;

    const failAll = (error) => {
        for (const {reject, timer} of pending.values()) {
            clearTimeout(timer);
            reject(error);
        }
        pending.clear();
    };

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line.trim() === '') continue;
            stdoutLines.push(line);
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                continue; // recorded in stdoutLines; the protocol test asserts on it
            }
            const waiter = pending.get(message.id);
            if (waiter) {
                clearTimeout(waiter.timer);
                pending.delete(message.id);
                waiter.resolve(message);
            }
        }
    });
    child.on('exit', (code, signal) => {
        exit = {code, signal};
        failAll(new Error(`server exited (code ${code}, signal ${signal}) before replying. stderr:\n${stderr}`));
    });

    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

    return {
        stdoutLines,
        get stderr() { return stderr; },
        get exit() { return exit; },
        request(method, params = {}) {
            const id = nextId++;
            return new Promise((resolve, reject) => {
                if (exit) {
                    reject(new Error(`server already exited (code ${exit.code}). stderr:\n${stderr}`));
                    return;
                }
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error(`no reply to ${method} within ${timeoutMs} ms. stderr:\n${stderr}`));
                }, timeoutMs);
                pending.set(id, {resolve, reject, timer});
                send({jsonrpc: '2.0', id, method, params});
            });
        },
        notify(method, params = {}) {
            send({jsonrpc: '2.0', method, params});
        },
        async initialize() {
            const reply = await this.request('initialize', {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: {name: 'figma-flutter-tests', version: '1.0.0'},
            });
            this.notify('notifications/initialized');
            return reply;
        },
        async close() {
            if (exit) return exit;
            const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({code, signal})));
            child.stdin.end();
            const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
            const result = await exited;
            clearTimeout(timer);
            return result;
        },
    };
}
