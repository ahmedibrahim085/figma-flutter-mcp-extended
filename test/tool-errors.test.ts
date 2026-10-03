import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callToolsOffline, FILE_KEY} from './helpers/offline-tool.ts';

/** A temp Flutter project, so the asset tools get past their pubspec check to the Figma call. */
async function tempProject(t: TestContext): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'figma-flutter-errors-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    await writeFile(join(dir, 'pubspec.yaml'), 'name: app\n');
    return dir;
}

/** Every tool that calls Figma, with arguments that reach its first Figma request. */
const figmaTools = (projectPath: string): Array<[string, Record<string, unknown>]> => [
    ['ff_get_metadata', {fileKey: FILE_KEY, nodeId: '1:2'}],
    ['ff_get_metadata', {fileKey: FILE_KEY}],
    ['ff_get_screenshot', {fileKey: FILE_KEY, nodeId: '1:2'}],
    ['ff_get_design_context', {fileKey: FILE_KEY, nodeId: '1:2'}],
    ['ff_get_variable_defs', {fileKey: FILE_KEY}],
    ['ff_whoami', {}],
    ['analyze_figma_component', {input: FILE_KEY, nodeId: '1:2'}],
    ['list_component_variants', {input: FILE_KEY, nodeId: '1:2'}],
    ['inspect_component_structure', {input: FILE_KEY, nodeId: '1:2'}],
    ['generate_flutter_implementation', {input: FILE_KEY, nodeId: '1:2'}],
    ['analyze_frame_as_screen', {input: FILE_KEY, nodeId: '1:2'}],
    ['inspect_frame_structure', {input: FILE_KEY, nodeId: '1:2'}],
    ['extract_theme_colors', {fileId: FILE_KEY, nodeId: '1:2', projectPath}],
    ['inspect_color_frame', {fileId: FILE_KEY, nodeId: '1:2'}],
    ['extract_theme_typography', {fileId: FILE_KEY, nodeId: '1:2', projectPath}],
    ['inspect_text_style_frame', {fileId: FILE_KEY, nodeId: '1:2'}],
    ['export_flutter_assets', {fileId: FILE_KEY, nodeIds: ['1:2'], projectPath}],
    ['export_svg_flutter_assets', {fileId: FILE_KEY, nodeIds: ['1:2'], projectPath}],
];

// Figma REST paths every tool above can reach.
const FIGMA_PATHS = [
    `/files/${FILE_KEY}`,
    `/files/${FILE_KEY}/nodes`,
    `/images/${FILE_KEY}`,
    `/files/${FILE_KEY}/variables/local`,
    `/files/${FILE_KEY}/images`,
    '/me',
];

const answerEverywhere = (response: {status: number; headers?: Record<string, string>; body: unknown}) =>
    Object.fromEntries(FIGMA_PATHS.map((path) => [path, response]));

test('every Figma-calling tool reports a 404 as an error that names the status', async (t) => {
    const calls = figmaTools(await tempProject(t));
    // The fake answers 404 for a path it has no route for.
    const results = await callToolsOffline({}, calls);

    const notErrors = results.flatMap((r, i) => (r.isError && /404/.test(r.text) ? [] : [`${calls[i][0]}: isError=${r.isError} ${r.text.slice(0, 80)}`]));
    assert.deepEqual(notErrors, []);
});

test('every Figma-calling tool retries a 429 the same way, three requests', async (t) => {
    const calls = figmaTools(await tempProject(t));
    const results = await callToolsOffline(
        answerEverywhere({status: 429, headers: {'Retry-After': '1'}, body: {status: 429, err: 'Rate limit exceeded'}}),
        calls,
    );

    const wrong = results.flatMap((r, i) => (r.isError && /429/.test(r.text) && r.requests.length === 3 ? [] : [`${calls[i][0]}: isError=${r.isError} requests=${r.requests.length} ${r.text.slice(0, 80)}`]));
    assert.deepEqual(wrong, []);
});
