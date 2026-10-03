import { type NextFunction, type Request, type Response } from "express";
import { Server } from "http";
import cors from "cors";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {registerAllTools} from "./tools/index.js";
import { Logger } from "./utils/logger.js";
import { getPackageVersion } from "./config.js";
import defaults from "./defaults.json" with { type: "json" };
import { configureProjectPath } from "./utils/project-conventions.js";

export function createServer(figmaApiKey: string) {
    const server = new McpServer({
        name: "figma-flutter",
        version: getPackageVersion()
    });

    registerAllTools(server, figmaApiKey);
    return server;
}

let httpServer: Server | null = null;

// Helper function to extract Figma API key from request
function extractFigmaApiKey(req: Request, fallbackApiKey?: string): string | null {
  // Try to get from Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Try to get from custom header
  const figmaApiKey = req.headers['x-figma-api-key'] as string;
  if (figmaApiKey) {
    return figmaApiKey;
  }
  
  // Try to get from query parameter (less secure, but convenient for testing)
  const queryApiKey = req.query.figmaApiKey as string;
  if (queryApiKey) { 
    return queryApiKey;
  }
  
  // Fall back to server-wide API key (only for non-remote HTTP mode)
  return fallbackApiKey || null;
}

export async function startMcpServer(figmaApiKey: string): Promise<void> {
    try {
        const server = createServer(figmaApiKey);
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("Figma-to-Flutter MCP Server connected via stdio");
    } catch (error) {
        console.error("Failed to start MCP server:", error);
        process.exit(1);
    }
}

/**
 * Refuses a request whose Origin is not trusted: the MCP spec (Streamable HTTP, Security Warning) says a server MUST
 * validate Origin against DNS rebinding and answer an invalid one with 403. A request with no Origin is a non-browser
 * client and is served. The SDK 1.27.1 transport options for this are deprecated and it ships no Origin middleware.
 */
function originValidation(allowedOrigins: string[]) {
  const trusted = (origin: string) => {
    if (allowedOrigins.includes(origin)) return true;
    try {
      return defaults.trustedOriginHosts.includes(new URL(origin).hostname);
    } catch {
      return false; // "null" and other values that are not an origin
    }
  };
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin === undefined || trusted(origin)) return next();
    res.status(403).json({jsonrpc: "2.0", error: {code: -32000, message: `Invalid Origin: ${origin}`}, id: null});
  };
}

export async function startHttpServer(port: number, figmaApiKey: string | undefined, {host, allowedOrigins, remote}: {host: string; allowedOrigins: string[]; remote: boolean}): Promise<void> {
  // HTTP mode keeps no session (MCP 2025-11-25 makes sessions optional): every POST is served by its own server and
  // transport, which are closed when the response closes. The Figma key comes from the request, or the fallback key.
  // The SDK's Express app parses JSON and, for a loopback `host`, refuses a Host header that is not localhost (DNS rebinding).
  // In remote mode a server key would serve every caller who can reach the port, so each request must bring its own
  // (the MCP spec says servers SHOULD authenticate all connections); on a loopback bind the server key is the user's own.
  if (remote && figmaApiKey) Logger.log("The server's FIGMA_API_KEY is ignored in --remote mode: every request must carry its own Figma key");
  const fallbackApiKey = remote ? undefined : figmaApiKey;
  const app = createMcpExpressApp({host});
  configureProjectPath(true);

  app.use(originValidation(allowedOrigins));
  app.use(cors({origin: true})); // only a trusted or absent Origin gets here; the trusted one is echoed back

  app.post("/mcp", async (req, res) => {
    Logger.log("Received StreamableHTTP request");

    // Extract Figma API key from request
    const userFigmaApiKey = extractFigmaApiKey(req, fallbackApiKey);
    if (!userFigmaApiKey) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized: Figma API key required. You must provide your own Figma API key via Authorization header (Bearer token), X-Figma-Api-Key header, or figmaApiKey query parameter. Get your API key from: https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens",
        },
        id: null,
      });
      return;
    }

    // A request with a progressToken is answered as an event stream so its progress reaches the client;
    // any other request is answered as plain JSON.
    const progressToken = req.body?.params?._meta?.progressToken;
    const mcpServer = createServer(userFigmaApiKey);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: progressToken === undefined,
    });

    let progressInterval: NodeJS.Timeout | null = null;
    res.on("close", () => {
      if (progressInterval) clearInterval(progressInterval);
      transport.close();
      mcpServer.close();
    });

    await mcpServer.connect(transport);

    if (progressToken !== undefined) {
      let progress = 0;
      // A protocol constant, not a design fact: one progress notification per second keeps a long
      // tool call well inside the SDK's default 60 s request timeout
      // (DEFAULT_REQUEST_TIMEOUT_MSEC in @modelcontextprotocol/sdk shared/protocol).
      progressInterval = setInterval(async () => {
        Logger.log("Sending progress notification", progress);
        await mcpServer.server.notification({
          method: "notifications/progress",
          params: {
            progress,
            progressToken,
          },
        }, {relatedRequestId: req.body.id});
        progress++;
      }, 1000);
    }

    Logger.log("Handling StreamableHTTP request");
    await transport.handleRequest(req, res, req.body);
    Logger.log("StreamableHTTP request handled");
  });

  // No session and no standalone stream: GET and DELETE have nothing to open or end.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: {code: -32000, message: "Method not allowed."},
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  httpServer = app.listen(port, host, (error?: Error) => {
    // Express 5 hands a failed listen (EADDRINUSE, a bad address) to this callback instead of throwing.
    if (error) {
      Logger.error(`HTTP server cannot listen on ${host}:${port}:`, error);
      process.exit(1);
    }
    Logger.log(`HTTP server listening on port ${port} (address ${host})`);
    Logger.log(`StreamableHTTP endpoint available at http://localhost:${port}/mcp`);
  });

  process.on("SIGINT", () => {
    Logger.log("Shutting down server...");
    Logger.log("Server shutdown complete");
    process.exit(0);
  });
}

export async function stopHttpServer(): Promise<void> {
  if (!httpServer) {
    throw new Error("HTTP server is not running");
  }

  return new Promise((resolve, reject) => {
    httpServer!.close((err: Error | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      httpServer = null;
      resolve();
    });
  });
}
