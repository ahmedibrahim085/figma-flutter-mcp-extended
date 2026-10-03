// HTTP mode: Origin is validated (MCP spec, Streamable HTTP "Security Warning": an invalid Origin gets 403), the Host
// header is validated against DNS rebinding, and the server listens on localhost unless told otherwise.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {networkInterfaces} from 'node:os';
import {httpRequest, withHttpServer} from './helpers/mcp-http.ts';

const LIST = {jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}};
const withOrigin = (origin: string) => ({headers: {origin}});

test('a request with no Origin (a non-browser client) and one from a trusted origin are served', async () => {
    await withHttpServer({}, async (endpoint) => {
        const plain = await httpRequest(endpoint, 'key-a', {message: LIST});
        const local = await httpRequest(endpoint, 'key-a', {message: LIST, ...withOrigin('http://localhost:6274')});
        const loopback = await httpRequest(endpoint, 'key-a', {message: LIST, ...withOrigin('http://127.0.0.1:6274')});

        assert.equal(plain.status, 200);
        assert.equal(local.status, 200);
        assert.equal(loopback.status, 200);
        assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:6274');
    });
});

test('an untrusted Origin gets 403 with a JSON-RPC error, on POST, GET and DELETE, and no CORS grant', async () => {
    await withHttpServer({}, async (endpoint) => {
        for (const method of ['POST', 'GET', 'DELETE']) {
            const response = await httpRequest(endpoint, 'key-a', {method, message: method === 'POST' ? LIST : undefined, ...withOrigin('https://evil.example')});

            assert.equal(response.status, 403, method);
            assert.match((await response.json()).error.message, /Invalid Origin/, method);
            assert.equal(response.headers.get('access-control-allow-origin'), null, method);
        }
    });
});

test('only an http or https origin on a trusted host is trusted: ftp://localhost and file://localhost are not', async () => {
    await withHttpServer({}, async (endpoint) => {
        for (const origin of ['ftp://localhost', 'file://localhost', 'chrome-extension://localhost']) {
            const response = await httpRequest(endpoint, 'key-a', {message: LIST, ...withOrigin(origin)});

            assert.equal(response.status, 403, origin);
        }
        assert.equal((await httpRequest(endpoint, 'key-a', {message: LIST, ...withOrigin('https://localhost:8443')})).status, 200);
    });
});

test('--allowed-origin is normalised to an origin, so a trailing slash still matches', async () => {
    await withHttpServer({}, async (endpoint) => {
        const response = await httpRequest(endpoint, 'key-a', {message: LIST, ...withOrigin('https://inspector.example')});

        assert.equal(response.status, 200);
    }, {args: ['--allowed-origin=https://inspector.example/']});
});

test('an --allowed-origin that is not an origin stops the server at start-up, naming the value', async () => {
    await assert.rejects(
        withHttpServer({}, async () => assert.fail('the server must not start'), {args: ['--allowed-origin=not an origin']}),
        /not an origin.*is not a valid origin|is not a valid origin.*not an origin/s,
    );
});

test('--allowed-origin trusts one more origin', async () => {
    await withHttpServer({}, async (endpoint) => {
        const response = await httpRequest(endpoint, 'key-a', {message: LIST, ...withOrigin('https://inspector.example')});

        assert.equal(response.status, 200);
    }, {args: ['--allowed-origin=https://inspector.example']});
});

/** The Host header is set by hand: fetch would send the address it connects to. */
function getWithHost(endpoint: string, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const req = request(endpoint, {method: 'POST', headers: {host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-figma-api-key': 'key-a'}}, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
        });
        req.on('error', reject);
        req.end(JSON.stringify(LIST));
    });
}

test('a Host header that is not localhost is refused (DNS rebinding), localhost with any port is served', async () => {
    await withHttpServer({}, async (endpoint) => {
        assert.equal(await getWithHost(endpoint, 'rebind.example'), 403);
        assert.equal(await getWithHost(endpoint, 'localhost:5555'), 200);
    });
});

const lanAddress = Object.values(networkInterfaces()).flat().find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address;

test('by default the server listens on localhost only; --host opens it', {skip: lanAddress ? false : 'this machine has no non-loopback IPv4 address'}, async () => {
    const viaLan = (endpoint: string) => endpoint.replace('127.0.0.1', lanAddress!);
    await withHttpServer({}, async (endpoint) => {
        await assert.rejects(fetch(viaLan(endpoint), {method: 'POST', signal: AbortSignal.timeout(3000)}), 'the default bind is reachable from another interface');
    });
    await withHttpServer({}, async (endpoint) => {
        const response = await fetch(viaLan(endpoint), {method: 'POST', signal: AbortSignal.timeout(3000)});
        assert.ok(response.status > 0);
    }, {args: ['--host=0.0.0.0']});
});

test('plain --http uses the server\'s Figma key for a request that brings none; --remote does not', async () => {
    await withHttpServer({}, async (endpoint) => {
        const response = await httpRequest(endpoint, '', {message: LIST});

        assert.equal(response.status, 200);
    });
    await withHttpServer({}, async (endpoint) => {
        const without = await httpRequest(endpoint, '', {message: LIST});
        const own = await httpRequest(endpoint, 'key-a', {message: LIST});

        assert.equal(without.status, 401);
        assert.match((await without.json()).error.message, /Figma API key required/);
        assert.equal(own.status, 200);
    }, {args: ['--remote']});
});
