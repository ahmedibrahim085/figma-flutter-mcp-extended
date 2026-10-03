import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RUN_DIR_ENV, RUN_FLAG_ENV} from './helpers/mcp-stdio.ts';

// tools/test-run.mjs owns a folder per run; a signal must stop the run and still remove that folder.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNS = join(ROOT, '.test-runs');
const HOLD = 'test/fixtures/hold.test.ts';
const runFolders = () => (existsSync(RUNS) ? readdirSync(RUNS).filter((name) => name.startsWith('run-')) : []);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts a nested test-run on the hold fixture, waits until `ready(folder)`, sends SIGTERM, returns the exit, the folder and the ms the wrapper took to exit. */
async function terminate(ready: (folder: string) => boolean) {
    const before = new Set(runFolders());
    const env = {...process.env};
    delete env[RUN_DIR_ENV];
    delete env[RUN_FLAG_ENV];
    // Set by the outer `node --test` for its child: left in, the nested runner takes itself for a child and runs nothing.
    delete env.NODE_TEST_CONTEXT;
    const nested = spawn(process.execPath, ['tools/test-run.mjs', HOLD], {cwd: ROOT, env, stdio: 'ignore'});
    const exit = new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve) =>
        nested.once('exit', (code, signal) => resolve({code, signal})));
    let folder: string | undefined;
    while (!folder || !ready(join(RUNS, folder))) {
        folder = runFolders().find((name) => !before.has(name));
        await sleep(50);
    }
    const sent = Date.now();
    nested.kill('SIGTERM');
    return {exit: await exit, folder: join(RUNS, folder), exitMs: Date.now() - sent};
}

test('SIGTERM during the build removes the run folder and exits non-zero', async () => {
    const {exit, folder} = await terminate(() => true);
    assert.equal(existsSync(folder), false, `${folder} was left behind`);
    assert.deepEqual(exit.signal, null, 'the wrapper must handle SIGTERM itself, not die from it');
    assert.notEqual(exit.code, 0);
});

test('SIGTERM during the tests removes the run folder and exits non-zero', async () => {
    // The fixture writes `started` into the run folder once the suite is running.
    const {exit, folder, exitMs} = await terminate((dir) => existsSync(join(dir, 'started')));
    // The fixture holds for 60 s: the wrapper must stop it, not wait it out.
    assert.ok(exitMs < 30000, `the wrapper took ${exitMs} ms to exit after SIGTERM`);
    assert.equal(existsSync(folder), false, `${folder} was left behind`);
    assert.deepEqual(exit.signal, null, 'the wrapper must handle SIGTERM itself, not die from it');
    assert.notEqual(exit.code, 0);
});
