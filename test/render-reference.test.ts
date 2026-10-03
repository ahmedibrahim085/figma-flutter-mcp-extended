import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startFakeFigma} from './helpers/fake-figma.ts';
import {FILE_KEY} from './helpers/offline-tool.ts';
import {builtCliPath} from './helpers/mcp-stdio.ts';

// The render check compares each render with Figma's own screenshot of the node (decision 26).
// The screenshots live beside the fixtures with a manifest; tools/render-check/capture-screenshots.mts recaptures them.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(ROOT, 'test', 'fixtures', 'screenshots');
const manifestOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
const pngSize = (bytes: Buffer) => ({width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)});
const findNode = (node: any, id: string): any => node.id === id ? node : (node.children ?? []).map((c: any) => findNode(c, id)).find(Boolean);

test('every fixture node with a MAGED id has its Figma screenshot: size equals the node box, id and capture date recorded', () => {
    const manifest = manifestOf(SHOTS);
    assert.deepEqual(manifest.screenshots.map((s: any) => s.nodeId),
        ['1:8', '1:20', '1:34', '1:64', '1:92', '2:15', '2:19', '2:23', '2:27', '2:31']);
    assert.equal(manifest.scale, 1);
    assert.equal(manifest.useAbsoluteBounds, true);
    for (const shot of manifest.screenshots) {
        const payload = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', shot.fixture), 'utf-8'));
        const node = (Object.values(payload.nodes) as any[]).map((entry) => findNode(entry.document, shot.nodeId)).find(Boolean);
        assert.ok(node, `${shot.nodeId} is not in ${shot.fixture}`);
        const png = readFileSync(join(SHOTS, shot.file));
        assert.deepEqual(pngSize(png), {width: node.absoluteBoundingBox.width, height: node.absoluteBoundingBox.height}, `${shot.nodeId} image size`);
        assert.deepEqual({width: shot.width, height: shot.height}, pngSize(png), `${shot.nodeId} manifest size`);
        assert.match(shot.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `${shot.nodeId} capture date`);
    }
});

test('the recapture script asks Figma for scale 1 with absolute bounds and records size and capture date', async () => {
    // 1x1 RGBA PNG: a real image whose size differs from the manifest's, so the script must read it from the file.
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const work = mkdtempSync(join(tmpdir(), 'ff-capture-'));
    writeFileSync(join(work, 'manifest.json'), JSON.stringify({scale: 1, useAbsoluteBounds: true, screenshots: [
        {nodeId: '1:92', fixture: 'component-button-set.json', file: '1_92.png', width: 109, height: 47, capturedAt: '2000-01-01T00:00:00Z'},
    ]}));
    const figma = await startFakeFigma((baseUrl) => ({
        [`/images/${FILE_KEY}?ids=1:92&format=png&scale=1&use_absolute_bounds=true`]: {body: {images: {'1:92': `${baseUrl}/render/1_92`}}},
        '/render/1_92': {body: PNG},
    }));
    try {
        const run = spawn(process.execPath, ['--import', 'tsx', 'tools/render-check/capture-screenshots.mts', '--manifest', join(work, 'manifest.json'), '--out', work, '--cli', builtCliPath()], {
            cwd: ROOT,
            env: {PATH: process.env.PATH, FIGMA_API_KEY: 'test-key', FIGMA_API_BASE_URL: figma.baseUrl, FIGMA_FILE_KEY: FILE_KEY},
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        run.stdout.on('data', (chunk) => { output += chunk; });
        run.stderr.on('data', (chunk) => { output += chunk; });
        const code = await new Promise((resolve) => run.once('exit', resolve));
        assert.equal(code, 0, output);
    } finally {
        await figma.close();
    }
    assert.deepEqual(readFileSync(join(work, '1_92.png')), PNG);
    const [shot] = manifestOf(work).screenshots;
    assert.deepEqual({width: shot.width, height: shot.height}, {width: 1, height: 1});
    assert.notEqual(shot.capturedAt, '2000-01-01T00:00:00Z');
    assert.match(shot.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(existsSync(join(work, 'manifest.json')), true);
});
