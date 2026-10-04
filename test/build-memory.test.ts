// The build must stay far below the Node heap limit: `npm install` of this package runs tsc (the `prepare` script) on the
// user's machine with that machine's default heap. Until 2026-10-04 tsc used 4.0 GB of a 4.1 GB heap (register B3.147) because
// the tool files imported zod from its root entry while the MCP SDK's types use `zod/v3`: 17.9 million type instantiations
// against 76 thousand with the subpath.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Measured on 2026-10-04 (tsc 5.9.3, zod 3.25.76, SDK 1.27.1 and 1.32.0): instantiations 17,889,106 before the change in both SDK versions
// (the count does not vary between runs), 75,896 after; memory 4.0 GB (4,005,376K to 4,044,191K over five runs) before, 210 MB after.
// The count is the exact measure; the ceiling leaves room for new tools and sits 90 times below the count that filled the heap.
const MAX_INSTANTIATIONS = 200_000;

test('tsc --noEmit uses at most half of the default Node heap limit and under 200,000 type instantiations', () => {
    const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    const run = spawnSync(process.execPath, [tsc, '--noEmit', '--extendedDiagnostics'], {cwd: ROOT, encoding: 'utf-8', maxBuffer: 1 << 24});
    const limit = Number(spawnSync(process.execPath, ['-p', "require('v8').getHeapStatistics().heap_size_limit"], {encoding: 'utf-8'}).stdout);
    const usedKb = Number(run.stdout.match(/^Memory used:\s+(\d+)K/m)?.[1]);
    const instantiations = Number(run.stdout.match(/^Instantiations:\s+(\d+)/m)?.[1]);

    assert.equal(run.status, 0, run.stdout.slice(-2000) + run.stderr.slice(-2000));
    assert.ok(usedKb > 0 && limit > 0, `no memory figure in the tsc output: ${run.stdout.slice(-500)}`);
    assert.ok(instantiations > 0 && instantiations <= MAX_INSTANTIATIONS, `tsc made ${instantiations} type instantiations; the ceiling is ${MAX_INSTANTIATIONS}`);
    assert.ok(usedKb * 1024 <= limit / 2, `tsc used ${(usedKb / 1024).toFixed(0)} MB; the target is ${(limit / 2 / 1048576).toFixed(0)} MB (half of the ${(limit / 1048576).toFixed(0)} MB heap limit)`);
});

test('no source file imports zod from its root entry: the MCP SDK types use zod/v3', () => {
    const files = (dir: string): string[] => readdirSync(dir, {withFileTypes: true}).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []);
    const offenders = files(join(ROOT, 'src')).filter((file) => /from\s+['"]zod['"]/.test(readFileSync(file, 'utf-8')));

    assert.deepEqual(offenders, [], 'import {z} from "zod/v3" instead: see test/build-memory.test.ts');
});
