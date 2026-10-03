import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withServer, RUN_DIR_ENV, RUN_FLAG_ENV} from './helpers/mcp-stdio.ts';

// `npm test` builds once into a folder the run owns (tools/test-run.mjs) and names it in RUN_DIR_ENV.
// A rebuild of the repo's dist/ (another run, a reviewer, `npm run build`) must not reach the servers.
const REPO_CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('a server starts from the run-owned build while the repo dist/cli.js is being rewritten', {skip: process.env[RUN_FLAG_ENV] ? false : `a run by hand uses the repo dist/; start it with npm test (${RUN_FLAG_ENV} unset)`}, async () => {
    // The wrapper sets the flag; a flag without the folder means the wrapper broke, and skipping would hide it.
    assert.ok(process.env[RUN_DIR_ENV], `${RUN_FLAG_ENV} is set but ${RUN_DIR_ENV} is not`);
    // tsc opens every output file with flag "w", which empties it first; a server loading it then sees no module.
    // A fresh checkout has no repo dist/ (npm test no longer builds it); the test then creates and removes the file.
    const original = existsSync(REPO_CLI) ? readFileSync(REPO_CLI) : undefined;
    mkdirSync(dirname(REPO_CLI), {recursive: true});
    writeFileSync(REPO_CLI, '');
    try {
        await withServer(async (server) => {
            const reply = await server.initialize();
            assert.equal(reply.result.serverInfo.name.length > 0, true);
        });
    } finally {
        if (original) writeFileSync(REPO_CLI, original); else rmSync(REPO_CLI);
    }
});

test('the server start timeout is the one in test/helpers/harness.json', async () => {
    const previous = process.env[RUN_DIR_ENV];
    const fixture = mkdtempSync(join(tmpdir(), 'ff-silent-'));
    // A server that reads stdin and never replies to initialize.
    mkdirSync(join(fixture, 'dist'));
    writeFileSync(join(fixture, 'dist', 'cli.js'), 'process.stdin.resume();\n');
    process.env[RUN_DIR_ENV] = fixture;
    try {
        await assert.rejects(
            withServer((server) => server.initialize()),
            (error: Error) => {
                assert.match(error.message, /no reply to initialize within 60000 ms/);
                return true;
            }
        );
    } finally {
        if (previous === undefined) delete process.env[RUN_DIR_ENV]; else process.env[RUN_DIR_ENV] = previous;
    }
});
