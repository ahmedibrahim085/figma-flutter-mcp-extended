// A stand-in for the Figma REST API: serves canned responses by path and
// records every request, so tool calls run offline and deterministically.
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';

export interface FakeResponse {
    status?: number;
    headers?: Record<string, string>;
    /** Objects are sent as JSON; Buffers as raw bytes. */
    body: unknown;
}

export interface RecordedRequest {
    method: string;
    /** Path without the `/v1` prefix, e.g. `/files/KEY/nodes`. */
    path: string;
    query: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
}

export interface FakeFigma {
    /** Base URL to hand to the server under test (includes `/v1`). */
    baseUrl: string;
    requests: RecordedRequest[];
    close(): Promise<void>;
}

/**
 * Starts a fake Figma API on a free local port. `routes` maps a path (without
 * `/v1`), optionally with its exact query string (`/files/K/nodes?ids=1:2`), to a
 * response; a path+query key wins over a bare path key. An unknown path answers
 * 404 so a missing fixture fails loudly instead of silently reaching the real API.
 */
export async function startFakeFigma(routes: Record<string, FakeResponse>): Promise<FakeFigma> {
    const requests: RecordedRequest[] = [];
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname.replace(/^\/v1/, '');
        requests.push({
            method: req.method ?? 'GET',
            path,
            query: Object.fromEntries(url.searchParams),
            headers: req.headers,
        });
        const route = routes[`${path}${url.search}`] ?? routes[path];
        if (!route) {
            res.writeHead(404, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({status: 404, err: `fake Figma has no fixture for ${path}`}));
            return;
        }
        const isBytes = Buffer.isBuffer(route.body);
        res.writeHead(route.status ?? 200, {
            'Content-Type': isBytes ? 'application/octet-stream' : 'application/json',
            ...route.headers,
        });
        res.end(isBytes ? route.body : JSON.stringify(route.body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const {port} = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requests,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
