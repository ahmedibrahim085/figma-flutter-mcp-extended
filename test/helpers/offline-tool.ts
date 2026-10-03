// One tool call against the real server with Figma replaced by the fake.
import {withServer} from './mcp-stdio.ts';
import {startFakeFigma, type FakeResponse, type FakeRoutes, type RecordedRequest} from './fake-figma.ts';

export const FILE_KEY = 'TESTFILEKEY0000000000A';

export interface OfflineToolResult {
    /** Text of the tool's first content item. */
    text: string;
    /** The MCP result's `isError` flag, which tells the client the call failed. */
    isError: boolean;
    /** Requests the fake Figma server received. */
    requests: RecordedRequest[];
}

/** Serves `routes` from a fake Figma, calls `tool` once over stdio, returns its text. */
export async function callToolOffline(
    routes: FakeRoutes,
    tool: string,
    args: Record<string, unknown>,
): Promise<OfflineToolResult> {
    const [result] = await callToolsOffline(routes, [[tool, args]]);
    return result;
}

/**
 * Like callToolOffline, but makes several calls in one server process.
 * Each result lists only the requests its own call made. `env` is added to the server's environment;
 * the harness turns the Figma cache off, so a test of the cache passes FIGMA_CACHE and FIGMA_CACHE_DIR.
 */
export async function callToolsOffline(
    routes: FakeRoutes,
    calls: Array<[tool: string, args: Record<string, unknown>]>,
    env: Record<string, string> = {},
): Promise<OfflineToolResult[]> {
    const figma = await startFakeFigma(routes);
    const results: OfflineToolResult[] = [];
    try {
        await withServer(async (server) => {
            await server.initialize();
            for (const [tool, args] of calls) {
                const before = figma.requests.length;
                const reply: any = await server.request('tools/call', {name: tool, arguments: args});
                results.push({
                    text: reply.result.content[0].text,
                    isError: reply.result.isError === true,
                    requests: figma.requests.slice(before),
                });
            }
        }, {env: {FIGMA_API_BASE_URL: figma.baseUrl, ...env}});
    } finally {
        await figma.close();
    }
    return results;
}

/**
 * Route for FigmaService.getNode / getNodes: `/files/KEY/nodes?ids=<id>` answering one node.
 * `styles` is the response's top-level style map: style id to `{name, styleType}`.
 */
export function nodeRoute(
    nodeId: string,
    document: object,
    styles?: Record<string, {name: string; styleType: string}>,
): Record<string, FakeResponse> {
    return {[`/files/${FILE_KEY}/nodes?ids=${nodeId}`]: {body: {nodes: {[nodeId]: {document, ...(styles ? {styles} : {})}}}}};
}

/**
 * Replaces generated style ids so output compares across runs. Ids are the
 * category plus a 12-character base36 id with its first character uppercased
 * (`decorationMujwk412ueha`), or `<category>Merged` plus 12 lowercase base36
 * characters; words such as `textDirection` do not match.
 */
export function normalizeStyleIds(text: string): string {
    return text.replace(/\b(decoration|padding|text|layout)(?:Merged[a-z0-9]{12}|[A-Z0-9][a-z0-9]{11})\b/g, '$1ID');
}
