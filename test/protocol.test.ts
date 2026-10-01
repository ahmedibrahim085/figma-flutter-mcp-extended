import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withServer, type JsonRpcMessage} from './helpers/mcp-stdio.ts';

// Independent source of truth: the tool names registered in src/tools.
const EXPECTED_TOOLS = [
    'analyze_figma_component',
    'analyze_full_screen',
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
    'generate_golden_test_scaffold',
    'inspect_component_structure',
    'inspect_screen_structure',
    'inspect_theme_frame',
    'inspect_typography_frame',
    'list_component_variants',
    'style_library_status',
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
    assert.deepEqual(tools, EXPECTED_TOOLS);
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
    const cli = new URL('../dist/cli.js', import.meta.url).pathname;
    const run = spawnSync(process.execPath, [cli, '--stdio'], {cwd, env, encoding: 'utf-8', timeout: 15000});
    assert.equal(run.status, 1);
    assert.match(run.stderr, /npx -y github:ahmedibrahim085\/figma-flutter-mcp-extended --figma-api-key=YOUR_KEY --stdio/);
    assert.doesNotMatch(run.stderr, /npx figma-flutter /);
});
