import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// What end users install is what `npm pack` would publish; development tools and tests stay out of it.
// `npm test` packs the folder it built for this run (the repo's dist/ may be rebuilt meanwhile); a run by hand packs the repo.
const ROOT = process.env.FIGMA_FLUTTER_TEST_DIST ? dirname(process.env.FIGMA_FLUTTER_TEST_DIST) : fileURLToPath(new URL('..', import.meta.url));
const SHIPPED_FILES = ['package.json', 'README.md', 'LICENSE.md'];

test('the published package holds only the built server and its README, license and manifest', () => {
    // --ignore-scripts: `npm test` has already built dist/, so pack needs no prepare step. npm 10 runs `prepare` anyway,
    // so the run folder's package.json has no scripts (tools/test-run.mjs); a run by hand rebuilds the repo's dist/.
    const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {cwd: ROOT, encoding: 'utf-8'});
    assert.equal(pack.status, 0, pack.stderr);
    const files: string[] = JSON.parse(pack.stdout)[0].files.map((file: {path: string}) => file.path);
    assert.ok(files.some((path) => path.startsWith('dist/')), 'the package must contain the built server');
    assert.deepEqual(files.filter((path) => !path.startsWith('dist/') && !SHIPPED_FILES.includes(path)), []);
});
