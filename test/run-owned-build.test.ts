import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withServer} from './helpers/mcp-stdio.ts';

// `npm test` builds once into a folder the run owns (tools/test-run.mjs) and names it in this variable.
// A rebuild of the repo's dist/ (another run, a reviewer, `npm run build`) must not reach the servers.
const RUN_DIST = 'FIGMA_FLUTTER_TEST_DIST';
const REPO_CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('a server starts from the run-owned build while the repo dist/cli.js is being rewritten', {skip: process.env[RUN_DIST] ? false : `a run by hand uses the repo dist/; start it with npm test (${RUN_DIST} unset)`}, async () => {
    // tsc opens every output file with flag "w", which empties it first; a server loading it then sees no module.
    const original = readFileSync(REPO_CLI);
    writeFileSync(REPO_CLI, '');
    try {
        await withServer(async (server) => {
            const reply = await server.initialize();
            assert.equal(reply.result.serverInfo.name.length > 0, true);
        });
    } finally {
        writeFileSync(REPO_CLI, original);
    }
});

test('the server start timeout is the one in test/helpers/harness.json', async () => {
    const previous = process.env[RUN_DIST];
    const fixture = mkdtempSync(join(tmpdir(), 'ff-silent-'));
    // A server that reads stdin and never replies to initialize.
    writeFileSync(join(fixture, 'cli.js'), 'process.stdin.resume();\n');
    process.env[RUN_DIST] = fixture;
    try {
        await assert.rejects(
            withServer((server) => server.initialize()),
            (error: Error) => {
                assert.match(error.message, /no reply to initialize within 60000 ms/);
                return true;
            }
        );
    } finally {
        if (previous === undefined) delete process.env[RUN_DIST]; else process.env[RUN_DIST] = previous;
    }
});
