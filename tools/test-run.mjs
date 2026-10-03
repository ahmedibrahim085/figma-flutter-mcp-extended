// `npm test`: build once into a folder this run owns, run the suite against it, remove it.
// Servers start from that folder (FIGMA_FLUTTER_TEST_RUN_DIR), so another run, a reviewer or
// `npm run build` rewriting the repo's dist/ cannot empty a file a server is loading.
// The folder sits inside the repo so the servers' bare imports find the repo's node_modules;
// .test-runs/ is gitignored. Usage: node tools/test-run.mjs [test file ...]  (default: test/*.test.ts)
// The two variable names are spelled again in test/helpers/mcp-stdio.ts.
import {spawn} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tests = process.argv.length > 2 ? process.argv.slice(2) : ['test/*.test.ts'];

let child;
let signal;
// Installed before anything is created: a signal at any point stops the running step and the
// folder is still removed below. SIGKILL cannot be caught and leaves the folder behind.
for (const name of ['SIGINT', 'SIGTERM']) {
    process.on(name, () => {
        signal = name;
        child?.kill(name);
    });
}

const step = (command, args, options) => new Promise((resolve) => {
    if (signal) return resolve(1);
    child = spawn(command, args, {cwd: root, stdio: 'inherit', ...options});
    child.on('exit', (code) => resolve(signal ? 1 : code ?? 1));
});

mkdirSync(join(root, '.test-runs'), {recursive: true});
const run = mkdtempSync(join(root, '.test-runs', 'run-'));
let status;
try {
    status = await step(join(root, 'node_modules', '.bin', 'tsc'), ['--outDir', join(run, 'dist')]);
    if (status === 0) {
        // config.ts reads ../package.json next to dist/. Scripts are dropped so that packing this folder
        // (test/package-contents.test.ts) cannot run `prepare`, which npm 10 does even with --ignore-scripts.
        const {scripts, ...manifest} = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        writeFileSync(join(run, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        for (const file of ['README.md', 'LICENSE.md']) copyFileSync(join(root, file), join(run, file));
        status = await step(process.execPath, ['--import', 'tsx', '--test', ...tests], {
            env: {...process.env, FIGMA_FLUTTER_TEST_RUN: '1', FIGMA_FLUTTER_TEST_RUN_DIR: run},
        });
    }
} finally {
    rmSync(run, {recursive: true, force: true});
}
process.exit(status);
