import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('stdio: server identifies as figma-flutter and lists exactly the registered tools', async () => {
    let init: JsonRpcMessage | undefined;
    let list: JsonRpcMessage | undefined;
    await withServer(async (s) => {
        init = await s.initialize();
        list = await s.request('tools/list');
    });
    assert.equal(init!.result.serverInfo.name, 'figma-flutter');
    const names = list!.result.tools.map((tool: {name: string}) => tool.name).sort();
    assert.deepEqual(names, EXPECTED_TOOLS);
});

test('README lists exactly the tools the server serves', async () => {
    let list: JsonRpcMessage | undefined;
    await withServer(async (s) => {
        await s.initialize();
        list = await s.request('tools/list');
    });
    const served = list!.result.tools.map((tool: {name: string}) => tool.name).sort();
    // The tool list in the README sits between these two markers; each tool name is in backticks.
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const section = readme.split('<!-- tools:start -->')[1]?.split('<!-- tools:end -->')[0] ?? '';
    const listed = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort();
    assert.deepEqual(listed, served);
});
