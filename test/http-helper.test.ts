// withHttpServer must fail fast with the server's own error when the server cannot start, never hang.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {withHttpServer} from './helpers/mcp-http.ts';
import {START_FAILURE_TEST_TIMEOUT_MS} from './helpers/mcp-stdio.ts';

test('a server that exits at start-up fails the helper within seconds, with the server\'s error text', {timeout: START_FAILURE_TEST_TIMEOUT_MS}, async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const {port} = taken.address() as {port: number};
    try {
        await assert.rejects(
            withHttpServer({}, async () => assert.fail('the body must not run against a server that never started'), {port}),
            /EADDRINUSE/,
        );
    } finally {
        taken.close();
    }
});
