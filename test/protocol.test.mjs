import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from './helpers/mcp-stdio.mjs';

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
    const server = startServer();
    try {
        await server.initialize();
        await server.request('tools/list');
    } finally {
        await server.close();
    }
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
    const server = startServer();
    let init;
    let list;
    try {
        init = await server.initialize();
        list = await server.request('tools/list');
    } finally {
        await server.close();
    }
    assert.equal(init.result.serverInfo.name, 'figma-flutter');
    const names = list.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, EXPECTED_TOOLS);
});
