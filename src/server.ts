import express, { type Request, type Response } from "express";
import { Server } from "http";
import cors from "cors";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {registerAllTools} from "./tools/index.js";
import { Logger } from "./utils/logger.js";
import { getPackageVersion } from "./config.js";
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

export async function startHttpServer(port: number, figmaApiKey?: string): Promise<void> {
  // HTTP mode keeps no session (MCP 2025-11-25 makes sessions optional): every POST is served by its own server and
  // transport, which are closed when the response closes. The Figma key comes from the request, or the fallback key.
  const app = express();
  configureProjectPath(true);

  app.use(cors({
    origin: '*', // Allow all origins - adjust as needed for production
  }));

  // Parse JSON requests for the Streamable HTTP endpoint only, will break SSE endpoint
  app.use("/mcp", express.json());

  app.post("/mcp", async (req, res) => {
    Logger.log("Received StreamableHTTP request");

    // Extract Figma API key from request
    const userFigmaApiKey = extractFigmaApiKey(req, figmaApiKey);
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

  httpServer = app.listen(port, () => {
    Logger.log(`HTTP server listening on port ${port}`);
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
