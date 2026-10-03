// Recaptures the render check's reference images: Figma's own screenshot of each fixture node (decision 26).
// Usage: FIGMA_FILE_KEY=<file key> node --import tsx tools/render-check/capture-screenshots.mts [--env <.env path>] [--manifest <file>] [--out <dir>] [--cli <cli.js>]
// Reads test/fixtures/screenshots/manifest.json, asks the built server's ff_get_screenshot for each node (scale and
// useAbsoluteBounds from the manifest), writes the PNGs next to the manifest and records each image's size and capture date.
// The Figma key comes from --env (as for the server) or FIGMA_API_KEY; the file key is never written to the repo.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const flag = (name: string) => {
    const at = process.argv.indexOf(name);
    return at < 0 ? undefined : process.argv[at + 1];
};
const manifestPath = resolve(flag('--manifest') ?? join(ROOT, 'test', 'fixtures', 'screenshots', 'manifest.json'));
const outDir = resolve(flag('--out') ?? dirname(manifestPath));
const cli = resolve(flag('--cli') ?? join(ROOT, 'dist', 'cli.js'));
const envFile = flag('--env');
const fileKey = process.env.FIGMA_FILE_KEY;
if (!fileKey) {
    console.error('set FIGMA_FILE_KEY to the file the fixture nodes were read from');
    process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const server = spawn(process.execPath, [cli, '--stdio', ...(envFile ? ['--env', envFile] : [])], {cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe']});
// The server logs every request URL, which holds the file key: show its stderr without it, and keep the tail for a failure.
let stderrTail = '';
server.stderr.on('data', (chunk) => {
    const text = String(chunk).replaceAll(fileKey, '<file key>');
    process.stderr.write(text);
    stderrTail = (stderrTail + text).slice(-2000);
});
let finished = false;
const exited = new Promise<never>((_, reject) => server.once('exit', (code, signal) => {
    if (!finished) reject(new Error(`the server exited (code ${code}, signal ${signal}) before replying; its stderr ended:\n${stderrTail}`));
}));
exited.catch(() => {}); // each request races it; this only marks it handled between requests
let buffer = '';
let nextId = 1;
const pending = new Map<number, (message: any) => void>();
server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const message = line.trim() ? JSON.parse(line) : undefined;
        if (message?.id !== undefined) pending.get(message.id)?.(message);
    }
});
const send = (message: object) => server.stdin.write(`${JSON.stringify(message)}\n`);
const request = (method: string, params: object) => Promise.race([exited, new Promise<any>((resolveReply) => {
    const id = nextId++;
    pending.set(id, resolveReply);
    send({jsonrpc: '2.0', id, method, params});
})]);

try {
    await request('initialize', {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'render-check-capture', version: '1.0.0'}});
    send({jsonrpc: '2.0', method: 'notifications/initialized', params: {}});
    for (const shot of manifest.screenshots) {
        const reply = await request('tools/call', {name: 'ff_get_screenshot', arguments: {
            fileKey, nodeId: shot.nodeId, scale: manifest.scale, useAbsoluteBounds: manifest.useAbsoluteBounds,
        }});
        const image = reply.result?.content?.[0];
        if (reply.result?.isError || image?.type !== 'image') {
            throw new Error(`${shot.nodeId}: ${image?.text ?? JSON.stringify(reply.error ?? reply.result)}`);
        }
        const png = Buffer.from(image.data, 'base64');
        writeFileSync(join(outDir, shot.file), png);
        shot.width = png.readUInt32BE(16);
        shot.height = png.readUInt32BE(20);
        shot.capturedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        console.log(`${shot.nodeId} ${shot.width}x${shot.height} ${shot.capturedAt} -> ${shot.file}`);
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
    finished = true;
    server.stdin.end();
}
