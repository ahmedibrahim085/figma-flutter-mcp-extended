// `npm test`: build once into a folder this run owns, run the suite against it, remove it.
// Servers start from that folder (FIGMA_FLUTTER_TEST_DIST), so another run, a reviewer or
// `npm run build` rewriting the repo's dist/ cannot empty a file a server is loading.
// The folder sits inside the repo so the servers' bare imports find the repo's node_modules;
// .test-runs/ is gitignored.
import {spawn, spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runsDir = join(root, '.test-runs');
mkdirSync(runsDir, {recursive: true});
const run = mkdtempSync(join(runsDir, 'run-'));
let status = 1;
try {
    const build = spawnSync(join(root, 'node_modules', '.bin', 'tsc'), ['--outDir', join(run, 'dist')], {cwd: root, stdio: 'inherit'});
    if (build.status !== 0) throw new Error(`tsc exited ${build.status}`);
    // config.ts reads ../package.json next to dist/. Scripts are dropped so that packing this folder
    // (test/package-contents.test.ts) cannot run `prepare`, which npm 10 does even with --ignore-scripts.
    const {scripts, ...manifest} = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    writeFileSync(join(run, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const file of ['README.md', 'LICENSE.md']) copyFileSync(join(root, file), join(run, file));
    const tests = spawn(process.execPath, ['--import', 'tsx', '--test', 'test/*.test.ts'], {
        cwd: root,
        stdio: 'inherit',
        env: {...process.env, FIGMA_FLUTTER_TEST_DIST: join(run, 'dist')},
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => tests.kill(signal));
    status = await new Promise((resolve) => tests.on('exit', (code) => resolve(code ?? 1)));
} catch (error) {
    console.error(error.message);
} finally {
    rmSync(run, {recursive: true, force: true});
}
process.exit(status);
