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

`npm test` (`tools/test-run.mjs`) builds the server once into a folder it owns, `.test-runs/run-*` (gitignored, removed when the run ends or gets SIGINT/SIGTERM), then runs `test/*.test.ts` against that folder with Node's built-in runner (`node --test`, TypeScript through `tsx`). A rebuild of the repo's `dist/`, by another run or by hand, cannot reach a running test. It needs no network and no Figma key. SIGKILL cannot be caught, so a run killed that way leaves its `.test-runs/run-*` folder behind; delete it by hand. A single test file run by hand (`node --import tsx --test test/x.test.ts`) uses the repo's `dist/`: run `npm run build` first, or run `node tools/test-run.mjs test/x.test.ts` to get a run-owned build.

- **Drive the server as a client does.** Tests start the built `cli.js --stdio` (from the run folder, see above) and speak MCP JSON-RPC (`test/helpers/mcp-stdio.ts`). Do not import tool internals; assert on what a tool returns. The helper fails the test if the server exits uncleanly or tries to reach the network (a test that must reach it passes `allowNetworkAttempts: true`), and keeps every stdout line so `test/protocol.test.ts` can check that stdout carries only JSON-RPC.
- **Replace Figma with the fake.** `test/helpers/fake-figma.ts` serves canned responses by path and query (`/files/KEY/nodes?ids=1:2`), answers 404 for anything unlisted, can send error statuses and headers (403, 429 with `Retry-After`), and records every request. `callToolOffline()` in `test/helpers/offline-tool.ts` wires one tool call to it, `callToolsOffline()` several calls in one server process (style state carries over), and `nodeRoute()` serves a single node.
- **Fixtures.** Small node shapes are built inline in the test. Real Figma payloads live in `test/fixtures/` as node data only: no file keys, component keys, URLs or account data (a test checks every `.json` file there).
- **Temp projects.** Tests that write files (asset export) create their own temp Flutter project and remove it when the test ends.
- **Pinned defects.** `test/characterization.test.ts` (hand-built nodes) and `test/real-fixtures.test.ts` (real Figma fixtures) assert today's known-wrong output. Each test name says `pins current behaviour, slice N replaces this`. A change that fixes one of these defects rewrites that test to assert the correct output in the same commit; never delete a pin to make the suite pass.

### Defaults (`src/defaults.json`)

Environment facts live in `src/defaults.json`, not in code: the HTTP port, the install command shown in the start-up hint, the Figma web URL, the retry policy, the Material 3 breakpoint steps (width and height lower bounds), the default device pixel ratios for PNG export, and the folder and file names the tools write (assets, theme, typography, golden tests). Change a value there to change the behaviour; no code edit is needed. The `lib/` and `test/` folders themselves are not in it: the Dart package layout fixes them, so the folder names in the file are relative to them (`themeSubdir` and `constantsSubdir` under `lib/`, `goldenTestSubdir` under `test/`). The CLI flags and environment variables (`--port`, `HTTP_PORT`, `FIGMA_API_BASE_URL`, `FIGMA_API_KEY`) still override what they override.

### Developer tools (`tools/`)

These run from any clone and are not part of the published package: `npm pack` ships only `dist/`, `README.md`, `LICENSE.md` and `package.json`, and `test/package-contents.test.ts` fails if anything else would ship.

- **Render check.** `npm run render-check -- <fixture> <nodeId>` compares one fixture node's render with Figma. It uses FVM's Flutter (`tools/render-check/flutter/.fvmrc` pins 3.47.5; without that file, `flutter` on `PATH`; the Homebrew `flutter` on one machine exits 137 at start). It:
  - generates Dart for the node offline, through the code `generate_flutter_implementation` uses, with each child keyed by its Figma node id (`withNodeKeys`; normal output has no keys), and runs `dart analyze`;
  - loads the design's fonts (`tools/render-check/flutter/fonts/`, listed in `fonts.json`, Inter 4.1 under the SIL OFL) in `test/flutter_test_config.dart`, and refuses a fixture whose text names a family or weight that is not listed;
  - renders the widget in four hosts (bounded, horizontal scroll, vertical scroll, inside a `Row`) on a screen of the node's own Figma size, and in each host compares the root's size and every keyed child's offset and size with the fixture's numbers (`<node id> <axis>: Figma <n>, Flutter <m> (tolerance <t>)`), lists Flutter's layout errors, and, in the bounded host, compares the image with Figma's own screenshot of the node;
  - fails on any of these, naming the node and both numbers, and saves the rendered image and the difference under `tools/render-check/flutter/failures/` (gitignored).

  Reference images: `test/fixtures/screenshots/` holds Figma's screenshot (scale 1, `useAbsoluteBounds`) of each fixture node that exists in the MAGED test file, with `manifest.json` (node id, size, capture date). Recapture with `FIGMA_FILE_KEY=<file key> node --import tsx tools/render-check/capture-screenshots.mts --env <.env path>`. `flutter test --update-goldens` throws; only that script writes a reference. `theme-colours-frame.json` and `typography-slots-frame.json` are synthetic (Figma answers "not found") and `alignment-frame.json`'s root 2:14 is a page, so they have no image; its five probe frames do.

  Tolerances are in `tools/render-check/flutter/tolerances.json`, each with its reason: 0.5 logical px for positions and sizes; a pixel counts as different above 32/255 in any channel, and the image fails above 5% differing pixels. Measured on 2026-10-03 with Inter 4.1: the four text-free probes 2:15, 2:19, 2:23, 2:27 differ by 0.00%; node 1:92 by 3.71% outside Flutter's overflow stripe (10.64% with it); nodes whose render is wrong in layout differ by 6% to 20% (1:8, 1:64, 1:92, 2:31) or have another size (1:20, 1:34). The 32/255 and 5% values are provisional (decision 27): the limit is the smallest round value above the largest correct render (3.71%), and only one text node is among the correct renders, so re-measure when more nodes render correctly.

  `npm run render-check:all` runs every node in `tools/render-check/expected.json` (node, fixture, `pass` or `fail`, and for a `fail` the BACKLOG register id) and exits non-zero only when a result differs from the list: `NEW FAILURE <node>` (expected pass), `NOW PASSES <node> (<id>): remove it from the list`, `NOT LISTED <node>` (a reference image without an entry), or `ERROR <node>` (no usable result: a `fail` needs one of the check's own lines, because a compile error also ends in "Some tests failed.", so a crash cannot pass for a known failure). A node id that is not in the list exits 2 (`NOT IN LIST <id>`). Each mismatch names a log with the whole `run.sh` output. Add `--list <file>` for another list, or node ids to run only those. When a change fixes a known failure, remove its register id and set it to `pass`.

  Known failures it reports (each a defect, not a note): 1:20 and 1:34 (auto layout `layoutWrap: WRAP` emitted as one Row: B3.63, B3.71), 1:64 (INSTANCE children drawn as empty placeholders, B3.117), 1:92 (0.109 px overflow, B3.52), 1:8 (text widths 0.6 to 1.4 px off Figma's, B3.119), 2:31 (negative `itemSpacing`, B3.118). Example: `npm run render-check -- component-button-set.json 1:92`. The Flutter project is `tools/render-check/flutter/`; its generated files are gitignored.
- **Mutation runner.** `npm run mutants -- <list file> [test file ...]` applies each mutant (one line each: name, file, `perl -0pi` expression, separated by tabs), rebuilds, runs the tests, and reports whether a test failed. It edits files in place and reverts them with `git checkout`, so:
  - run it in a git worktree of the repo (`git worktree add`), never in a checkout someone else is using. A copy without `.git` is refused, because mutants are reverted with `git checkout`;
  - it refuses to start when there are uncommitted changes, and skips a mutant whose file git does not track;
  - on Ctrl-C, SIGTERM or SIGHUP it puts back the file it was mutating. Killed with SIGKILL, it leaves the mutant in the file. When its output is piped into a command that stops reading early, the run usually puts the file back (exit 141 when stdout is piped into `head`), but it has been seen to leave the mutant. Either way, a leftover mutant makes the next run refuse to start until you restore the file with `git checkout -- <file>`;
  - with `npm run`, the list path and the test files are both relative to the repo root (npm runs scripts there); called directly as `tools/mutants.sh`, the list path is relative to where you run it, and the test files are still relative to the repo root.
- **Literal scan.** `npm run --silent audit:literals > literals.tsv` lists every number, string, template and regex literal in `src/` with file, line and context. `node tools/lex-count.cjs` counts the same literals with the TypeScript lexer, as a cross-check. Digits and quotes inside regex literals count only there.
- **Literal baseline.** `npm test` runs `node tools/literal-scan.cjs --check`, which compares every literal in `src/` with `tools/literal-baseline.tsv` and fails on a new literal, on a baselined literal that is gone, and on a baseline row with no class or no reason.
  - A line has the columns `file`, `kind`, `text`, `context`, `function`, `count`, `class`, `reason`. The first five are the key (no line number, so edits above a literal do not re-key it); `count` is how many times the key occurs. Moving code to another file or function re-keys its literals: delete the old line and add the new one.
  - The failure message prints the file:line and the exact line to add or delete. Nothing writes the file for you. A fact (a cap, threshold, default, URL, name or list that Figma, Flutter or the owner decides) belongs in `src/defaults.json`; add a line only for something that stays in code.
  - Classes:
    - `K-TEXT`: report, label, log or error text.
    - `K-API`: a Figma or Flutter protocol value, path, enum, file name or documented default.
    - `K-DART`: emitted Dart code, or its punctuation and indentation.
    - `K-CONV`: an index, count, identity element, layout fallback, or unit or base conversion.
    - `K-SCHEMA`: tool and parameter names and descriptions, type-level literals, Dart reserved words, parsing and sanitising regexes.
    - `F-HEUR`, `F-DEFAULT`, `F-FACT`, `F-GUIDE`, `F-LEAK`: recorded debt, allowed only when the reason names the ticket, `B3.NN` entry or decision that removes it.

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

When the HTTP server is running, it serves one endpoint:

- **POST /mcp** - Streamable HTTP endpoint for MCP communication. It keeps no session: every request is served on its own, so no `initialize` and no session id are needed, and no `Mcp-Session-Id` is issued. Send the Figma key with each request (`Authorization: Bearer`, `X-Figma-Api-Key`, or the `figmaApiKey` query parameter), or start the server with a key. A request with a `progressToken` is answered as an event stream carrying its progress; any other request is answered as JSON.
- **GET /mcp** and **DELETE /mcp** answer 405.

### Who can reach the HTTP server

- **Address:** it listens on `127.0.0.1` only, so another machine cannot reach it or spend its Figma key. `--host <address>` (or `HTTP_HOST`) listens elsewhere. `--remote` (a server for other machines, whose users send their own Figma key) listens on `0.0.0.0` unless `--host` says otherwise. Both are in `src/defaults.json` with their reasons.
- **Figma key:** plain `--http` uses the server's key for a request that brings none (it listens on this machine only). `--remote` ignores the server's key and needs none to start: every request must carry its own (`Authorization: Bearer`, `X-Figma-Api-Key`, or `figmaApiKey`), and one without gets 401.
- **Origin:** a request with no `Origin` header (a non-browser client) is served. An `Origin` whose hostname is `localhost`, `127.0.0.1` or `[::1]` (any port) is served and gets the matching CORS headers. Any other `Origin` gets 403 with a JSON-RPC error, as the MCP spec requires against DNS rebinding. `--allowed-origin <origin>` (repeatable) or `HTTP_ALLOWED_ORIGINS` (comma separated) trusts more.
- **Host:** while it listens on a loopback address, a `Host` header that is not `localhost`, `127.0.0.1` or `[::1]` gets 403 (DNS rebinding), using the SDK's own check. With another `--host` the `Host` header is not checked, because the server cannot know its public name; the Figma key per request is the protection there.

Over HTTP the server's working folder is not your Flutter project, so the tools that write files (`extract_theme_colors`, `extract_theme_typography`, `export_flutter_assets`, `export_svg_flutter_assets`, `generate_golden_file_test`) need `projectPath` and return an error without it. Over stdio, `projectPath` defaults to the current directory.

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

# Optional: Figma cache folder (default: figma-flutter-mcp-extended under the OS cache folder) and FIGMA_CACHE=off to disable it.
# The tests set FIGMA_CACHE=off; the cache tests pass their own FIGMA_CACHE_DIR.
FIGMA_CACHE_DIR=

# Optional: HTTP mode address (default 127.0.0.1) and extra trusted browser origins, comma separated
HTTP_HOST=
HTTP_ALLOWED_ORIGINS=
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
