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
    const figma = await startFakeFigma(routes);
    let reply: any;
    try {
        await withServer(async (server) => {
            await server.initialize();
            reply = await server.request('tools/call', {name: tool, arguments: args});
        }, {env: {FIGMA_API_BASE_URL: figma.baseUrl}});
    } finally {
        await figma.close();
    }
    return {text: reply.result.content[0].text, isError: reply.result.isError === true, requests: figma.requests};
}

/** Route for FigmaService.getNode / getNodes: `/files/KEY/nodes?ids=<id>` answering one node. */
export function nodeRoute(nodeId: string, document: object): Record<string, FakeResponse> {
    return {[`/files/${FILE_KEY}/nodes?ids=${nodeId}`]: {body: {nodes: {[nodeId]: {document}}}}};
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
