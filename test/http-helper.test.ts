// withHttpServer must fail fast with the server's own error when the server cannot start, never hang.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {withHttpServer} from './helpers/mcp-http.ts';

test('a server that exits at start-up fails the helper within seconds, with the server\'s error text', {timeout: 20000}, async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, resolve));
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
