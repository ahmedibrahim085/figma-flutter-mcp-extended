// Report text and display labels come from src/labels.json. The replies below are pinned as exact text, written here
// (not read from the labels file), so moving a sentence into the file cannot change what a client sees.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callToolOffline} from './helpers/offline-tool.ts';
import {httpRequest, withHttpServer} from './helpers/mcp-http.ts';
import {label} from '../src/utils/labels.ts';

const GOLDEN_ARGS = {widgetName: 'ContinueButton', widgetImportPath: 'widgets/continue_button.dart'};

async function project(t: {after: (fn: () => Promise<void>) => void}, pubspec?: string) {
    const dir = mkdtempSync(join(tmpdir(), 'labels-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    if (pubspec !== undefined) writeFileSync(join(dir, 'pubspec.yaml'), pubspec);
    return dir;
}

test('generate_golden_file_test: the success reply is this text, with the two paths filled in', async (t) => {
    const dir = await project(t, 'name: my_shop\n');
    const {text, isError} = await callToolOffline({}, 'generate_golden_file_test', {...GOLDEN_ARGS, projectPath: dir});

    assert.equal(isError, false);
    assert.equal(text,
        `Golden file test written to ${join(dir, 'test', 'continue_button_golden_test.dart')}\n\n` +
        'This only sets up the test structure — it does not render or compare anything.\n' +
        'Run `flutter test --update-goldens` once to create the reference image at goldens/continue_button.png, then `flutter test` on later runs to check against it.');
});

test('generate_golden_file_test: a pubspec.yaml without name: is refused with this text', async (t) => {
    const dir = await project(t, 'flutter:\n  uses-material-design: true\n');
    const {text, isError} = await callToolOffline({}, 'generate_golden_file_test', {...GOLDEN_ARGS, projectPath: dir});

    assert.equal(isError, true);
    assert.equal(text, `pubspec.yaml in ${dir} has no name: line, so the widget import cannot be written. Nothing was written.`);
});

test('generate_golden_file_test: no pubspec.yaml is refused with this text', async (t) => {
    const dir = await project(t);
    const {text, isError} = await callToolOffline({}, 'generate_golden_file_test', {...GOLDEN_ARGS, projectPath: dir});

    assert.equal(isError, true);
    assert.equal(text, `No pubspec.yaml in ${dir}. Run this in a Flutter project (flutter create), or pass projectPath. Nothing was requested or written.`);
});

test('generate_golden_file_test over HTTP with no projectPath is refused with this text', async () => {
    await withHttpServer({}, async (endpoint) => {
        const response = await httpRequest(endpoint, 'key-a', {message: {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'generate_golden_file_test', arguments: GOLDEN_ARGS}}});
        const {result} = await response.json();

        assert.equal(result.isError, true);
        assert.equal(result.content[0].text,
            "Error generating golden file test: projectPath is required over HTTP: the server's working folder is not the client's project. " +
            "Pass the Flutter project's path on the machine that runs this server. Nothing was requested or written.");
    });
});

// ── the text lives in the labels file ───────────────────────────────────────

const labels = JSON.parse(readFileSync(new URL('../src/labels.json', import.meta.url), 'utf-8'));

test('the golden-test replies are the labels file text with the placeholders filled', async (t) => {
    const dir = await project(t, 'name: my_shop\n');
    const {text} = await callToolOffline({}, 'generate_golden_file_test', {...GOLDEN_ARGS, projectPath: dir});

    const expected = labels.goldenTest.written
        .replaceAll('{path}', join(dir, 'test', 'continue_button_golden_test.dart'))
        .replaceAll('{goldenPath}', 'goldens/continue_button.png');
    assert.equal(text, expected);
});

test('label fills every placeholder; a missing value, an unused value or an unknown key throws instead of printing {name}', () => {
    assert.equal(label('project', 'noPubspec', {projectPath: '/x'}),
        'No pubspec.yaml in /x. Run this in a Flutter project (flutter create), or pass projectPath. Nothing was requested or written.');
    assert.throws(() => label('project', 'noPubspec', {}), /projectPath/);
    assert.throws(() => label('project', 'noSuchKey' as never), /noSuchKey/);
    assert.throws(() => label('project', 'noPubspec', {projectPath: '/x', unused: 'y'}), /unused/);
});
