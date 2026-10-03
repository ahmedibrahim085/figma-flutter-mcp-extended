# figma-flutter

An MCP server that reads Figma designs and turns them into Flutter code: widgets, screens, themes, typography and assets.

This repository is a fork of [mhmzdev/figma-flutter-mcp](https://github.com/mhmzdev/figma-flutter-mcp) by Muhammad Hamza (MIT). It has moved far enough from upstream to need its own documentation; see [Attribution](#attribution) for what comes from upstream.

## What this fork adds

- **Core Figma tools** (`ff_*`) backed by the Figma REST API: node tree, screenshots, design context, variables.
- **Closer Flutter output** for components:
  - text keeps its full `TextStyle`; mixed-style runs become `Text.rich`;
  - auto layout maps to Flutter: fixed and hug sizing, alignment, item gaps as `SizedBox`, FILL children that never meet an unbounded constraint, min/max sizes as constraints;
  - absolute children and frames without auto layout become a `Stack` placed by the Figma constraints;
  - child frames and shapes render recursively, and hidden nodes stay hidden.
- **No silent layout guesses:** where the layout code cannot match Figma exactly, it carries an `// approximate:` comment and the tool lists every such approximation.
- **Safer runtime:**
  - in stdio mode, stdout carries JSON-RPC only;
  - after a Figma 429, the component, screen, theme and asset tools and `ff_get_variable_defs` say how long to wait; `analyze_figma_component` and `ff_get_variable_defs` also mark Figma errors as tool errors;
  - asset export no longer corrupts `pubspec.yaml`.
- **A golden file test tool** and a test suite (`npm test`).

## Requirements

- Node.js 18 or later, and git (the server installs from GitHub).
- A Figma personal access token: [how to create one](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens).

## Install

The package is not published to npm. `npx` installs it straight from GitHub and builds it on first use.

The first run builds the server and can take more than a minute. That is longer than some clients wait for a server to start, so run it once before adding it to a client:

```bash
npx -y github:ahmedibrahim085/figma-flutter-mcp-extended --version
```

### Claude Code

```bash
claude mcp add figma-flutter -e FIGMA_API_KEY=YOUR-API-KEY -- npx -y github:ahmedibrahim085/figma-flutter-mcp-extended --stdio
```

### Cursor and other clients (JSON config)

macOS / Linux:

```json
{
  "mcpServers": {
    "figma-flutter": {
      "command": "npx",
      "args": ["-y", "github:ahmedibrahim085/figma-flutter-mcp-extended", "--stdio"],
      "env": {"FIGMA_API_KEY": "YOUR-API-KEY"}
    }
  }
}
```

Windows:

```json
{
  "mcpServers": {
    "figma-flutter": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "github:ahmedibrahim085/figma-flutter-mcp-extended", "--stdio"],
      "env": {"FIGMA_API_KEY": "YOUR-API-KEY"}
    }
  }
}
```

The key can also be passed as `--figma-api-key=YOUR-API-KEY`, or loaded from a file with `--env /path/to/.env`.

## Tools

<!-- tools:start -->
| Tool | What it does |
|---|---|
| `ff_get_metadata` | Node tree of a file or node: IDs, names, types, bounding boxes |
| `ff_get_screenshot` | PNG, JPG, SVG or PDF image of one node |
| `ff_get_design_context` | Layout tree, components, styles, text and properties of a node |
| `ff_get_variable_defs` | Variables from the Variables panel: colors, spacing, typography, radii |
| `ff_whoami` | The authenticated Figma user; checks that the key works |
| `analyze_figma_component` | Structure, styles and (optionally) Flutter code for a component or component set |
| `list_component_variants` | The variants in a component set |
| `inspect_component_structure` | Quick overview of a component's children and nested components |
| `generate_flutter_implementation` | Flutter widget code for one node (file key or URL plus node ID), with the style definitions it uses |
| `analyze_frame_as_screen` | Layout, child layers, navigation and assets of a frame treated as a screen |
| `inspect_frame_structure` | Quick overview of a frame's child layers and navigation |
| `extract_theme_colors` | Colors from a frame of labelled color samples, optionally as `ThemeData` |
| `inspect_color_frame` | Preview of a frame of color samples before extraction |
| `extract_theme_typography` | Text styles from a frame of text samples, optionally as a `TextTheme` |
| `inspect_text_style_frame` | Preview of a frame of text samples before extraction |
| `export_flutter_assets` | Exports the given nodes, and descendants with export settings or an image fill, into the Flutter assets folder and updates `pubspec.yaml` |
| `export_svg_flutter_assets` | Exports the given nodes, and descendants with an SVG export setting, as SVG |
| `generate_golden_file_test` | Writes a `matchesGoldenFile` widget test file; it does not render or compare |
<!-- tools:end -->

## Workflow

Copy a link to a frame or component (Figma desktop: select it and press Cmd+L or Ctrl+L; web: copy the URL). A valid link contains a file ID and a node ID. Then ask your agent, for example:

1. **Theme and typography.** Put two frames in Figma, one with labelled color samples and one with text samples:

   ![Frame of color samples example](docs/images/theme-frame.png)
   ![Frame of text samples example](docs/images/text-style-frame.png)

   > "Set up the Flutter theme from <figma_link>, including colors and typography."

2. **Widgets.** Components work best, including component sets with variants:

   ![Button component with two variants](docs/images/button.png)

   > "Create this widget in Flutter from the Figma component <figma_link>; use named constructors for variants."

   A plain frame also works; say that you want it as a widget.

3. **Screens.** Image assets on the screen are exported to `assets/` and added to `pubspec.yaml`:

   <img src="docs/images/screen.png" alt="Screen example" height="500" width="auto">

   > "Build this screen from <figma_link>; keep the code in small files."

4. **SVG assets.** Figma treats icons and pen-tool shapes alike as vectors, so a bulk export can pick up the wrong nodes. Put the SVGs you want in their own frame or group and export them separately:

   <img src="docs/images/svgs_clean.gif" alt="Separating SVGs into their own frame" height="500" width="auto">

   <img src="docs/images/svg.gif" alt="A good and a bad SVG export" height="500" width="auto">

   > "Export this as an SVG asset from <figma_link>."

For better results, give your agent project rules (`CLAUDE.md`, `.cursor/rules/*.mdc`, `GEMINI.md`). [docs/cursor_rules_example.md](docs/cursor_rules_example.md) is an example.

## Limitations

- The output is a strong starting point, not production code to ship unreviewed.
- The cleaner the design (auto layout, frames rather than groups, consistent alignment), the closer the code.
- Heavy use can hit Figma rate limits (HTTP 429). The component, screen, theme and asset tools make up to 3 attempts with backoff and honour Figma's `Retry-After` when it is 10 seconds or less; a longer wait comes back as an error that states it. The `ff_*` tools do not retry.

## Cache

Reads of a file and its nodes, and rendered image bytes, are kept on disk while the Figma file is unchanged. Every such read first asks Figma for the file's `version` and `last_touched_at` with your own key, so a key that cannot open the file still gets Figma's error, and an edited file is fetched again. Figma's `version` alone does not change on every edit, so both values are part of the key. The tools ask only Figma, never the cache, about `/me`, render URLs and variables.

- Folder: `figma-flutter-mcp-extended` under the OS cache folder (`~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows, `$XDG_CACHE_HOME` or `~/.cache` elsewhere). `FIGMA_CACHE_DIR` replaces the whole path. Over HTTP the folder is on the server's disk.
- `FIGMA_CACHE=off` turns the cache off.
- The cache keeps the current version of each file and deletes older ones. It has no age or size limit. To clear it, delete the folder.

## Development

```bash
git clone https://github.com/ahmedibrahim085/figma-flutter-mcp-extended.git
cd figma-flutter-mcp-extended
npm install          # also builds dist/
npm test             # builds, then runs the test suite against the stdio server
```

To run a local HTTP server on port 3333, put `FIGMA_API_KEY=...` in a `.env` file and run `npm run dev`. Then point the client at it:

```json
{"mcpServers": {"figma-flutter-local": {"url": "http://localhost:3333/mcp"}}}
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

## Attribution

- This project starts from [figma-flutter-mcp](https://github.com/mhmzdev/figma-flutter-mcp) by [Muhammad Hamza](https://github.com/mhmzdev). Upstream also has:
  - README translations: [Korean](https://github.com/mhmzdev/figma-flutter-mcp/blob/main/README.ko.md), [Japanese](https://github.com/mhmzdev/figma-flutter-mcp/blob/main/README.ja.md), [Simplified Chinese](https://github.com/mhmzdev/figma-flutter-mcp/blob/main/README.zh-cn.md), [Traditional Chinese](https://github.com/mhmzdev/figma-flutter-mcp/blob/main/README.zh-tw.md);
  - a [getting-started guide](https://github.com/mhmzdev/figma-flutter-mcp/blob/main/docs/getting-started.md) and a [how-it-works page](https://github.com/mhmzdev/figma-flutter-mcp/blob/main/docs/figma-flutter-mcp.md);
  - the [release history](https://github.com/mhmzdev/figma-flutter-mcp/blob/main/CHANGELOG.md) up to 0.3.3.
- Upstream was inspired by [Figma Context MCP](https://github.com/GLips/Figma-Context-MCP) by Graham Lipsman.
- To build the same kind of server for another framework, see [docs/figma-framework-mcp.md](docs/figma-framework-mcp.md).

## License

MIT. See [LICENSE.md](LICENSE.md).
