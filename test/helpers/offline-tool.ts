// One tool call against the real server with Figma replaced by the fake.
import {withServer} from './mcp-stdio.ts';
import {startFakeFigma, type FakeResponse, type RecordedRequest} from './fake-figma.ts';

export const FILE_KEY = 'TESTFILEKEY0000000000A';

export interface OfflineToolResult {
    /** Text of the tool's first content item. */
    text: string;
    /** Requests the fake Figma server received. */
    requests: RecordedRequest[];
}

/** Serves `routes` from a fake Figma, calls `tool` once over stdio, returns its text. */
export async function callToolOffline(
    routes: Record<string, FakeResponse>,
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
    return {text: reply.result.content[0].text, requests: figma.requests};
}

/** Route for FigmaService.getNode / getNodes: `/files/KEY/nodes?ids=<id>` answering one node. */
export function nodeRoute(nodeId: string, document: object): Record<string, FakeResponse> {
    return {[`/files/${FILE_KEY}/nodes?ids=${nodeId}`]: {body: {nodes: {[nodeId]: {document}}}}};
}

/** Replaces generated style ids (e.g. `decorationMujwk412ueha`) so output compares across runs. */
export function normalizeStyleIds(text: string): string {
    return text.replace(/\b(decoration|padding|text|layout|style_)[A-Za-z0-9]{8,}\b/g, '$1ID');
}
