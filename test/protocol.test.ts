import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withServer, builtCliPath, SERVER_START_TIMEOUT_MS, type JsonRpcMessage} from './helpers/mcp-stdio.ts';
import {callToolOffline} from './helpers/offline-tool.ts';

// Independent source of truth: the tool names registered in src/tools.
const EXPECTED_TOOLS = [
    'analyze_figma_component',
    'analyze_frame_as_screen',
    'export_flutter_assets',
    'export_svg_flutter_assets',
    'extract_theme_colors',
    'extract_theme_typography',
    'ff_get_design_context',
    'ff_get_metadata',
    'ff_get_screenshot',
    'ff_get_variable_defs',
    'ff_whoami',
    'generate_flutter_implementation',
    'generate_golden_file_test',
    'inspect_color_frame',
    'inspect_component_structure',
    'inspect_frame_structure',
    'inspect_text_style_frame',
    'list_component_variants',
];

test('stdio: every stdout line is a JSON-RPC message', async () => {
    const server = await withServer(async (s) => {
        await s.initialize();
        await s.request('tools/list');
    });
    assert.ok(server.stdoutLines.length >= 2, `expected replies on stdout, got ${server.stdoutLines.length} lines`);
    const nonJson = server.stdoutLines.filter((line) => {
        try {
            JSON.parse(line);
            return false;
        } catch {
            return true;
        }
    });
    assert.deepEqual(nonJson, [], 'stdout must carry JSON-RPC only; diagnostics belong on stderr');
});

async function serve(): Promise<{init: JsonRpcMessage; tools: string[]}> {
    let init: JsonRpcMessage | undefined;
    let list: JsonRpcMessage | undefined;
    await withServer(async (s) => {
        init = await s.initialize();
        list = await s.request('tools/list');
    });
    return {init: init!, tools: list!.result.tools.map((tool: {name: string}) => tool.name).sort()};
}

test('stdio: server identifies as figma-flutter and lists exactly the registered tools', async () => {
    const {init, tools} = await serve();
    assert.equal(init.result.serverInfo.name, 'figma-flutter');
    // The version a client sees is the package's own version.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    assert.equal(init.result.serverInfo.version, pkg.version);
    assert.deepEqual(tools, EXPECTED_TOOLS);
});

test('stdio: the initialize instructions name the place to report a problem, from defaults.json', async () => {
    const {init} = await serve();
    const defaults = JSON.parse(readFileSync(new URL('../src/defaults.json', import.meta.url), 'utf-8'));
    assert.match(defaults.issuesUrl, /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues$/);
    assert.ok(init.result.instructions.includes(defaults.issuesUrl), init.result.instructions);
});

test('stdio: ff_whoami does not call itself exempt from rate limits: Figma puts GET /v1/me in Tier 3', async () => {
    let tools: any[] = [];
    await withServer(async (s) => {
        await s.initialize();
        tools = ((await s.request('tools/list')).result as any).tools;
    });
    const description: string = tools.find((tool) => tool.name === 'ff_whoami').description;

    assert.doesNotMatch(description, /exempt/i);
    assert.match(description, /Tier 3/);
});

test('stdio: generate_golden_file_test reports "Golden file test written to" the file it wrote, importing the pubspec package', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: my_shop\n');
    const {text, isError} = await callToolOffline({}, 'generate_golden_file_test',
        {widgetName: 'ContinueButton', widgetImportPath: 'widgets/continue_button.dart', projectPath: dir});
    assert.equal(isError, false);
    assert.match(text, /^Golden file test written to /);
    const written = join(dir, 'test', 'continue_button_golden_test.dart');
    assert.ok(existsSync(written), text);
    assert.match(readFileSync(written, 'utf-8'), /^import 'package:my_shop\/widgets\/continue_button\.dart';$/m);
});

test('stdio: README lists exactly the tools the server serves', async () => {
    const {tools} = await serve();
    // The tool list in the README sits between these two markers; each tool name is in backticks.
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf-8');
    const section = readme.match(/<!-- tools:start -->([\s\S]*?)<!-- tools:end -->/);
    assert.ok(section, 'README must hold the tool list between <!-- tools:start --> and <!-- tools:end -->');
    const listed = [...section[1].matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort();
    assert.deepEqual(listed, tools);
});

test('without a Figma key, the start-up hint installs from GitHub, not an unregistered npm name', () => {
    // An empty working directory, so no .env supplies a key.
    const cwd = mkdtempSync(join(tmpdir(), 'ff-nokey-'));
    const env = {...process.env};
    delete env.FIGMA_API_KEY;
    const run = spawnSync(process.execPath, [builtCliPath(), '--stdio'], {cwd, env, encoding: 'utf-8', timeout: SERVER_START_TIMEOUT_MS});
    assert.equal(run.status, 1);
    assert.match(run.stderr, /npx -y github:ahmedibrahim085\/figma-flutter-mcp-extended --figma-api-key=YOUR_KEY --stdio/);
    assert.doesNotMatch(run.stderr, /npx figma-flutter /);
});
