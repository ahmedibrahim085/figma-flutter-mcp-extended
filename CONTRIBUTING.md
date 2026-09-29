# Contributing to Figma Flutter MCP

Thank you for your interest in contributing to Figma Flutter MCP! This guide will help you get started with development and testing.

## 🚀 Quick Start for Contributors

### Prerequisites
- Node.js 18+
- npm or yarn
- Figma API Key (for testing)
- Git

### Setup Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/figma-flutter-mcp.git
   cd figma-flutter-mcp
   npm install
   ```

2. **Create .env file**
   ```bash
   # Create .env file with your Figma API key
   echo "FIGMA_API_KEY=your-figma-api-key-here" > .env
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```

## 📋 Development Guidelines

### Code Style
- Use TypeScript for all new code
- Follow existing code patterns and conventions
- Use meaningful variable and function names
- Add docs in `docs/` if you think its neccessary

### Project Structure
```
src/
├── cli.mts              # CLI entry point
├── server.mts           # MCP server implementation
├── config.mts           # Configuration handling
├── extractors/          # Figma data extractors
│   ├── colors/
│   ├── components/
│   ├── screens/
│   └── typography/
├── tools/               # Flutter code generators
├── services/            # External service integrations
├── types/               # TypeScript type definitions
└── utils/               # Utility functions
```

### Making Changes

1. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Make Your Changes**
   - Write clean, documented code
   - Add tests for new features
   - Update documentation as needed

3. **Test Your Changes**
   ```bash
   # Build and check for errors
   npm run build
   
   # Run the test suite (builds first; offline, no Figma key needed)
   npm test
   # Tests point FIGMA_API_BASE_URL at a local fake Figma server; unset, the real API is used
   
   # Test locally
   npm run dev
   ```

4. **Commit and Push**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   git push origin feature/your-feature-name
   ```

5. **Create Pull Request**
   - Use descriptive titles and descriptions
   - Reference any related issues
   - Include screenshots/examples if applicable

### Writing Tests

`npm test` builds the server, then runs `test/*.test.ts` with Node's built-in runner (`node --test`, TypeScript through `tsx`). It needs no network and no Figma key.

- **Drive the server as a client does.** Tests start `dist/cli.js --stdio` and speak MCP JSON-RPC (`test/helpers/mcp-stdio.ts`). Do not import tool internals; assert on what a tool returns. The helper fails the test if the server exits uncleanly or tries to reach the network (a test that must reach it passes `allowNetworkAttempts: true`), and keeps every stdout line so `test/protocol.test.ts` can check that stdout carries only JSON-RPC.
- **Replace Figma with the fake.** `test/helpers/fake-figma.ts` serves canned responses by path and query (`/files/KEY/nodes?ids=1:2`), answers 404 for anything unlisted, can send error statuses and headers (403, 429 with `Retry-After`), and records every request. `callToolOffline()` in `test/helpers/offline-tool.ts` wires one tool call to it, `callToolsOffline()` several calls in one server process (style state carries over), and `nodeRoute()` serves a single node.
- **Fixtures.** Small node shapes are built inline in the test. Real Figma payloads live in `test/fixtures/` as node data only: no file keys, component keys, URLs or account data (a test checks every `.json` file there).
- **Temp projects.** Tests that write files (asset export) create their own temp Flutter project and remove it when the test ends.
- **Pinned defects.** `test/characterization.test.ts` (hand-built nodes) and `test/real-fixtures.test.ts` (real Figma fixtures) assert today's known-wrong output. Each test name says `pins current behaviour, slice N replaces this`. A change that fixes one of these defects rewrites that test to assert the correct output in the same commit; never delete a pin to make the suite pass.

## 🧪 Local Testing & Development

The project supports HTTP server mode for easier development and testing. This allows you to test MCP tools without setting up a full MCP client.

### Setting Up Your Environment

If you haven't already set up your Figma API key:
```bash
# Create .env file
echo "FIGMA_API_KEY=your-figma-api-key-here" > .env
```

**Get your Figma API Key:**
1. Go to [Figma Settings > Personal Access Tokens](https://www.figma.com/developers/api#access-tokens)
2. Generate a new personal access token
3. Copy the token and add it to your `.env` file

⚠️ **Important**: Never commit your `.env` file to version control. It's already included in `.gitignore`.

### Development Server Options

#### Using npm scripts (recommended)
```bash
# Start HTTP server on default port 3333
npm run dev

# Start HTTP server on a specific port
npm run dev:port 4000

# Start in stdio mode (for MCP clients)
npm run dev:stdio
```

#### Using direct commands
```bash
# Start HTTP server
npx tsx src/cli.mts --http

# Start HTTP server on specific port
npx tsx src/cli.mts --http --port 4000

# Start in stdio mode
npx tsx src/cli.mts --stdio
```

#### Using built version
```bash
# Build first
npm run build

# Start HTTP server
node dist/cli.mjs --http

# Start HTTP server on specific port
node dist/cli.mjs --http --port 4000
```

## Connecting to the Server

### MCP Client Configuration

To connect an MCP client to the local HTTP server, add this configuration to your MCP JSON config file:

```json
{
  "mcpServers": {
    "local-figma-flutter-mcp": {
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

## Available Endpoints

When the HTTP server is running, the following endpoints are available:

- **POST /mcp** - Main Streamable HTTP endpoint for MCP communication
- **GET /mcp** - Session management for StreamableHTTP
- **DELETE /mcp** - Session termination for StreamableHTTP  
- **GET /sse** - Server-Sent Events endpoint (alternative transport)
- **POST /messages** - Message endpoint for SSE transport

## Environment Variables

You can configure the server using environment variables. The recommended approach is to use a `.env` file:

### Using .env file (Recommended)
```env
# Required: Your Figma API key
FIGMA_API_KEY=your-figma-api-key-here

# Optional: Enable HTTP mode by default
HTTP_MODE=true

# Optional: Set default HTTP port
HTTP_PORT=3333

# Optional: Figma REST base URL (default https://api.figma.com/v1; the tests point it at a local fake)
FIGMA_API_BASE_URL=https://api.figma.com/v1
```

## 📋 Pull Request Checklist

Before submitting a PR:
- [ ] Code builds without errors (`npm run build`)
- [ ] Tests pass (if applicable)
- [ ] Documentation updated
- [ ] PR description explains changes
- [ ] Related issues referenced
- [ ] Follows existing code style

Thank you for contributing to Figma Flutter MCP! 🚀
