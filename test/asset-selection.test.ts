import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import {callToolOffline, FILE_KEY} from './helpers/offline-tool.ts';
import {withServer} from './helpers/mcp-stdio.ts';
import type {FakeResponse, FakeRoutes} from './helpers/fake-figma.ts';

// Assets come from Figma's exportSettings and image fills, never from layer names (ticket 06).
// Expected values are written here, not read from the code.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const PUBSPEC = 'name: app\n\ndependencies:\n  flutter:\n    sdk: flutter\n\nflutter:\n  uses-material-design: true\n';

type Format = 'png' | 'jpg' | 'svg';
interface ImageCall {ids: string[]; format: Format; scale?: number; missing?: string[]; failDownload?: string[]}

const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
const setting = (format: string, type: string, value: number, suffix = '') => ({suffix, format, constraint: {type, value}});
const vector = (id: string, name: string, extra: object = {}) =>
    ({id, name, type: 'VECTOR', absoluteBoundingBox: box(24, 24), fills: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}], ...extra});
const photo = (id: string, name: string, extra: object = {}) =>
    ({id, name, type: 'RECTANGLE', absoluteBoundingBox: box(100, 100), fills: [{type: 'IMAGE', imageRef: 'ref'}], ...extra});
const screen = (children: object[]) => ({id: '5:1', name: 'Screen', type: 'FRAME', absoluteBoundingBox: box(375, 812), children});

async function tempProject(t: TestContext): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'figma-flutter-assets-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    await writeFile(join(dir, 'pubspec.yaml'), PUBSPEC);
    return dir;
}

/** Serves `root` under its id and each listed /images call with a render URL per node and the bytes. */
function figma(root: {id: string}, calls: ImageCall[]): FakeRoutes {
    return (baseUrl) => {
        const routes: Record<string, FakeResponse> = {
            [`/files/${FILE_KEY}/nodes?ids=${root.id}`]: {body: {nodes: {[root.id]: {document: root}}}},
        };
        for (const {ids, format, scale, missing = [], failDownload = []} of calls) {
            const query = format === 'svg' ? `ids=${ids.join(',')}&format=svg` : `ids=${ids.join(',')}&format=${format}&scale=${scale}`;
            routes[`/images/${FILE_KEY}?${query}`] = {body: {images: Object.fromEntries(ids.map((id) => [id, missing.includes(id) ? null : `${baseUrl}/render/${format}/${scale ?? 1}/${id}`]))}};
            for (const id of ids.filter((id) => !missing.includes(id))) {
                routes[`/render/${format}/${scale ?? 1}/${id}`] = failDownload.includes(id) ? {status: 404, body: 'gone'} : {body: format === 'svg' ? SVG : PNG};
            }
        }
        return routes;
    };
}

const imageRequests = (requests: Array<{path: string; query: Record<string, string>}>) =>
    requests.filter((r) => r.path.startsWith('/images/')).map((r) => ({ids: r.query.ids, format: r.query.format, scale: r.query.scale}));

const pubspecAssets = async (dir: string) => (yaml.load(await readFile(join(dir, 'pubspec.yaml'), 'utf-8')) as any).flutter.assets;

// ── 1. A layer name does not decide ─────────────────────────────────────────

const LOGO_SCREEN = screen([vector('5:2', 'logo'), {id: '5:3', name: 'zzz', type: 'RECTANGLE', absoluteBoundingBox: box(125, 50), exportSettings: [setting('PNG', 'SCALE', 1)]}]);

test('analyze_frame_as_screen: a VECTOR named logo without exportSettings is not requested; a descendant with exportSettings is, whatever its name', async (t) => {
    const dir = await tempProject(t);
    const {requests} = await callToolOffline(figma(LOGO_SCREEN, [{ids: ['5:3'], format: 'png', scale: 1}]), 'analyze_frame_as_screen',
        {input: FILE_KEY, nodeId: '5:1', extractAssets: true, projectPath: dir});

    assert.deepEqual(imageRequests(requests), [{ids: '5:3', format: 'png', scale: '1'}]);
    assert.deepEqual(await readFile(join(dir, 'assets/images/zzz.png')), PNG);
});

test('analyze_figma_component: the same rule, and the analysed root is never exported', async (t) => {
    const dir = await tempProject(t);
    const root = {...LOGO_SCREEN, exportSettings: [setting('PNG', 'SCALE', 4)]};
    const {requests} = await callToolOffline(figma(root, [{ids: ['5:3'], format: 'png', scale: 1}]), 'analyze_figma_component',
        {input: FILE_KEY, nodeId: '5:1', userDefinedComponent: true, exportAssets: true, projectPath: dir, useDeduplication: false});

    assert.deepEqual(imageRequests(requests), [{ids: '5:3', format: 'png', scale: '1'}]);
    assert.equal(existsSync(join(dir, 'assets/images/screen.png')), false);
});

test('export_flutter_assets: the passed IDs are exported; a logo vector inside one is not', async (t) => {
    const dir = await tempProject(t);
    const {requests} = await callToolOffline(figma(LOGO_SCREEN, [
        {ids: ['5:1'], format: 'png', scale: 2}, {ids: ['5:3'], format: 'png', scale: 1},
    ]), 'export_flutter_assets', {fileId: FILE_KEY, nodeIds: ['5:1'], projectPath: dir});

    const ids = imageRequests(requests).map((r) => r.ids).sort();
    assert.deepEqual(ids, ['5:1', '5:3']);
    assert.equal(existsSync(join(dir, 'assets/images/logo.png')), false);
});

// ── 2. Format and scale come from exportSettings ────────────────────────────

test('an SVG exportSetting requests format=svg and writes assets/svgs/; a PNG SCALE 3 writes 3.0x/ and lists the main path', async (t) => {
    const dir = await tempProject(t);
    const root = screen([
        photo('5:2', 'Mark', {exportSettings: [setting('SVG', 'SCALE', 1)]}),
        photo('5:3', 'Banner', {exportSettings: [setting('PNG', 'SCALE', 3)]}),
    ]);
    const {requests} = await callToolOffline(figma(root, [
        {ids: ['5:2'], format: 'svg'}, {ids: ['5:3'], format: 'png', scale: 3},
    ]), 'analyze_frame_as_screen', {input: FILE_KEY, nodeId: '5:1', extractAssets: true, projectPath: dir});

    assert.deepEqual(imageRequests(requests).sort((a, b) => a.format.localeCompare(b.format)),
        [{ids: '5:3', format: 'png', scale: '3'}, {ids: '5:2', format: 'svg', scale: undefined}]);
    assert.deepEqual(await readFile(join(dir, 'assets/svgs/mark.svg')), SVG);
    assert.deepEqual(await readFile(join(dir, 'assets/images/3.0x/banner.png')), PNG);
    assert.equal(existsSync(join(dir, 'assets/images/2.0x/banner.png')), false, 'exportSettings beat the devicePixelRatios default');
    assert.deepEqual((await pubspecAssets(dir)).sort(), ['assets/images/banner.png', 'assets/svgs/mark.svg']);
});

test('the default is 2.0x only, with the main path listed (pin)', async (t) => {
    const dir = await tempProject(t);
    await callToolOffline(figma(screen([photo('5:2', 'Hero Image')]), [{ids: ['5:2'], format: 'png', scale: 2}]), 'analyze_frame_as_screen',
        {input: FILE_KEY, nodeId: '5:1', extractAssets: true, projectPath: dir});

    assert.deepEqual(await readFile(join(dir, 'assets/images/2.0x/hero_image.png')), PNG);
    assert.equal(existsSync(join(dir, 'assets/images/hero_image.png')), false);
    assert.deepEqual(await pubspecAssets(dir), ['assets/images/hero_image.png']);
});

// ── 3. devicePixelRatios ────────────────────────────────────────────────────

test('devicePixelRatios [1.5, 3] writes 1.5x/ and 3.0x/ and only those, on all three PNG tools', async (t) => {
    const hero = photo('5:2', 'Hero Image');
    const calls: ImageCall[] = [{ids: ['5:2'], format: 'png', scale: 1.5}, {ids: ['5:2'], format: 'png', scale: 3}];
    const runs: Array<[string, {id: string}, Record<string, unknown>]> = [
        ['analyze_frame_as_screen', screen([hero]), {input: FILE_KEY, nodeId: '5:1'}],
        ['analyze_figma_component', screen([hero]), {input: FILE_KEY, nodeId: '5:1', userDefinedComponent: true, exportAssets: true, useDeduplication: false}],
        ['export_flutter_assets', hero, {fileId: FILE_KEY, nodeIds: ['5:2']}],
    ];
    for (const [tool, root, args] of runs) {
        const dir = await tempProject(t);
        await callToolOffline(figma(root, calls), tool, {...args, projectPath: dir, devicePixelRatios: [1.5, 3]});

        assert.deepEqual(await readFile(join(dir, 'assets/images/1.5x/hero_image.png')), PNG, tool);
        assert.deepEqual(await readFile(join(dir, 'assets/images/3.0x/hero_image.png')), PNG, tool);
        assert.equal(existsSync(join(dir, 'assets/images/2.0x/hero_image.png')), false, tool);
        assert.deepEqual(await pubspecAssets(dir), ['assets/images/hero_image.png'], tool);
    }
});

test('devicePixelRatios outside Flutter\'s documented ratios, or empty, is an error', async (t) => {
    for (const bad of [[2.5], [], [5]]) {
        const dir = await tempProject(t);
        const result = await callToolOffline(figma(screen([photo('5:2', 'Hero Image')]), []), 'analyze_frame_as_screen',
            {input: FILE_KEY, nodeId: '5:1', projectPath: dir, devicePixelRatios: bad}).catch((error) => ({isError: true, text: String(error)}));

        assert.equal(result.isError, true, JSON.stringify(bad));
        assert.equal(existsSync(join(dir, 'assets')), false);
    }
});

test('the old scale and includeMultipleResolutions inputs are gone from export_flutter_assets, and the ratio list reads the same everywhere', async () => {
    let properties: Record<string, any> = {};
    let description = '';
    await withServer(async (s) => {
        await s.initialize();
        const list: any = await s.request('tools/list');
        const tool = list.result.tools.find((tool: any) => tool.name === 'export_flutter_assets');
        properties = tool.inputSchema.properties;
        description = tool.description;
    });

    assert.match(description, /nearest ratio of 1, 1\.5, 2, 3, 4\)/);
    assert.match(properties.devicePixelRatios.description, /\(1, 1\.5, 2, 3, 4\)/);

    assert.ok('devicePixelRatios' in properties);
    assert.ok(!('scale' in properties) && !('includeMultipleResolutions' in properties));
});

// ── 4. WIDTH / HEIGHT export settings ───────────────────────────────────────

test('WIDTH 300 on a 125-wide node is 2.4x, snapped to 2x, and the report says so', async (t) => {
    const dir = await tempProject(t);
    const root = screen([{id: '5:2', name: 'Strip', type: 'RECTANGLE', absoluteBoundingBox: box(125, 40), exportSettings: [setting('PNG', 'WIDTH', 300, '@big')]}]);
    const {text, requests} = await callToolOffline(figma(root, [{ids: ['5:2'], format: 'png', scale: 2}]), 'analyze_frame_as_screen',
        {input: FILE_KEY, nodeId: '5:1', extractAssets: true, projectPath: dir});

    assert.deepEqual(imageRequests(requests), [{ids: '5:2', format: 'png', scale: '2'}]);
    assert.match(text, /WIDTH 300 → 2\.4x, exported at 2x/);
    assert.match(text, /suffix "@big" is reported, not used in the file name/);
    assert.deepEqual(await readFile(join(dir, 'assets/images/2.0x/strip.png')), PNG);
});

// ── 5. The SVG tool ─────────────────────────────────────────────────────────

test('export_svg_flutter_assets exports a requested frame with no vectors, and its description has no vector percentage', async (t) => {
    const dir = await tempProject(t);
    const frame = {id: '5:1', name: 'Plain Frame', type: 'FRAME', absoluteBoundingBox: box(40, 40), children: [], fills: []};
    const {text, requests} = await callToolOffline(figma(frame, [{ids: ['5:1'], format: 'svg'}]), 'export_svg_flutter_assets',
        {fileId: FILE_KEY, nodeIds: ['5:1'], projectPath: dir});

    assert.deepEqual(imageRequests(requests), [{ids: '5:1', format: 'svg', scale: undefined}]);
    assert.match(text, /Successfully exported 1 SVG assets/);
    assert.deepEqual(await readFile(join(dir, 'assets/svgs/plain_frame.svg')), SVG);

    let description = '';
    await withServer(async (s) => {
        await s.initialize();
        const list: any = await s.request('tools/list');
        description = list.result.tools.find((tool: any) => tool.name === 'export_svg_flutter_assets').description;
    });
    assert.doesNotMatch(description, /30%|25%|vector content|pen tool/i);
    assert.match(description, /exportSettings/);
});

test('export_svg_flutter_assets also exports a descendant that has an SVG exportSetting', async (t) => {
    const dir = await tempProject(t);
    const frame = {id: '5:1', name: 'Sheet', type: 'FRAME', absoluteBoundingBox: box(200, 200), children: [
        {id: '5:2', name: 'Glyph', type: 'FRAME', absoluteBoundingBox: box(20, 20), exportSettings: [setting('SVG', 'SCALE', 1)], children: []},
        {id: '5:3', name: 'Raster only', type: 'FRAME', absoluteBoundingBox: box(20, 20), exportSettings: [setting('PNG', 'SCALE', 2)], children: []},
    ]};
    const {requests} = await callToolOffline(figma(frame, [{ids: ['5:1', '5:2'], format: 'svg'}]), 'export_svg_flutter_assets',
        {fileId: FILE_KEY, nodeIds: ['5:1'], projectPath: dir});

    assert.deepEqual(imageRequests(requests), [{ids: '5:1,5:2', format: 'svg', scale: undefined}]);
});

// ── 6. Every raster scale is one of Flutter's ratios ────────────────────────

for (const [value, snapped, folder] of [[0.5, 1, ''], [5, 4, '4.0x/']] as const) {
    test(`a SCALE ${value} export setting is exported at ${snapped}x and the report says so`, async (t) => {
        const dir = await tempProject(t);
        const root = screen([photo('5:2', 'Tile', {exportSettings: [setting('PNG', 'SCALE', value)]})]);
        const {text, requests} = await callToolOffline(figma(root, [{ids: ['5:2'], format: 'png', scale: snapped}]), 'analyze_frame_as_screen',
            {input: FILE_KEY, nodeId: '5:1', extractAssets: true, projectPath: dir});

        assert.deepEqual(imageRequests(requests), [{ids: '5:2', format: 'png', scale: String(snapped)}]);
        assert.match(text, new RegExp(`SCALE ${value} → exported at ${snapped}x`));
        assert.deepEqual(await readFile(join(dir, `assets/images/${folder}tile.png`)), PNG);
        assert.equal(existsSync(join(dir, 'assets/images/0.5x')) || existsSync(join(dir, 'assets/images/5.0x')) || existsSync(join(dir, 'assets/images/5x')), false);
    });
}

// ── 7. A node Figma gave no image for is named, and not counted ─────────────

test('export_flutter_assets names a node Figma returned no image for and counts only what it wrote', async (t) => {
    const dir = await tempProject(t);
    const root = screen([photo('5:2', 'Kept'), photo('5:3', 'Lost')]);
    const {text} = await callToolOffline(figma(root, [
        {ids: ['5:1', '5:2', '5:3'], format: 'png', scale: 2, missing: ['5:3']},
    ]), 'export_flutter_assets', {fileId: FILE_KEY, nodeIds: ['5:1'], projectPath: dir});

    assert.match(text, /Successfully exported 2 image assets/);
    assert.match(text, /Lost \(5:3\): Figma returned no image/);
    assert.equal(existsSync(join(dir, 'assets/images/2.0x/lost.png')), false);
    assert.deepEqual(await readFile(join(dir, 'assets/images/2.0x/kept.png')), PNG);
});

test('the analyse tools name a node Figma returned no image for too', async (t) => {
    const dir = await tempProject(t);
    const root = screen([photo('5:2', 'Kept'), photo('5:3', 'Lost')]);
    const {text} = await callToolOffline(figma(root, [{ids: ['5:2', '5:3'], format: 'png', scale: 2, missing: ['5:3']}]), 'analyze_frame_as_screen',
        {input: FILE_KEY, nodeId: '5:1', extractAssets: true, projectPath: dir});

    assert.match(text, /Found and exported 1 screen asset/);
    assert.match(text, /Lost \(5:3\): Figma returned no image/);
});

// ── 8. A download that fails is named, with a short reason, and not counted ─

test('export_flutter_assets names a download that failed, keeps the notes of the rest, and counts only what it wrote', async (t) => {
    const dir = await tempProject(t);
    const root = screen([photo('5:2', 'Kept'), photo('5:3', 'Broken')]);
    const {text} = await callToolOffline(figma(root, [
        {ids: ['5:1', '5:2', '5:3'], format: 'png', scale: 2, failDownload: ['5:3']},
    ]), 'export_flutter_assets', {fileId: FILE_KEY, nodeIds: ['5:1'], projectPath: dir});

    assert.match(text, /Successfully exported 2 image assets/);
    assert.match(text, /Broken \(5:3\): download failed for png at \dx \(HTTP 404\); not exported/);
    assert.doesNotMatch(text, /render\/|http:\/\//);
    assert.equal(existsSync(join(dir, 'assets/images/2.0x/broken.png')), false);
    assert.deepEqual(await readFile(join(dir, 'assets/images/2.0x/kept.png')), PNG);
});

test('the analyse tools name a download that failed too, and a run where every download fails says so', async (t) => {
    const dir = await tempProject(t);
    const root = screen([photo('5:2', 'Kept'), photo('5:3', 'Broken', {exportSettings: [setting('PNG', 'WIDTH', 300, '@big')]})]);
    const some = await callToolOffline(figma(root, [{ids: ['5:2'], format: 'png', scale: 2}, {ids: ['5:3'], format: 'png', scale: 3, failDownload: ['5:3']}]),
        'analyze_frame_as_screen', {input: FILE_KEY, nodeId: '5:1', extractAssets: true, projectPath: dir});

    assert.match(some.text, /Found and exported 1 screen asset/);
    assert.match(some.text, /Broken \(5:3\): download failed for png at \dx \(HTTP 404\); not exported/);
    assert.match(some.text, /suffix "@big" is reported/);

    const none = await tempProject(t);
    const all = await callToolOffline(figma(screen([photo('5:2', 'Only')]), [{ids: ['5:2'], format: 'png', scale: 2, failDownload: ['5:2']}]),
        'analyze_figma_component', {input: FILE_KEY, nodeId: '5:1', userDefinedComponent: true, exportAssets: true, projectPath: none, useDeduplication: false});

    assert.match(all.text, /Only \(5:2\): download failed for png at 2x \(HTTP 404\); not exported/);
    assert.equal(existsSync(join(none, 'assets/images/2.0x/only.png')), false);
});

test('when one ratio of a node downloads and another fails, only the failed ratio is named', async (t) => {
    const dir = await tempProject(t);
    const hero = photo('5:2', 'Hero Image');
    const {text} = await callToolOffline(figma(hero, [
        {ids: ['5:2'], format: 'png', scale: 1.5}, {ids: ['5:2'], format: 'png', scale: 3, failDownload: ['5:2']},
    ]), 'export_flutter_assets', {fileId: FILE_KEY, nodeIds: ['5:2'], projectPath: dir, devicePixelRatios: [1.5, 3]});

    assert.match(text, /Successfully exported 1 image assets/);
    assert.deepEqual(await readFile(join(dir, 'assets/images/1.5x/hero_image.png')), PNG);
    assert.equal(existsSync(join(dir, 'assets/images/3.0x/hero_image.png')), false);
    const notes = text.split('\n').filter((line) => line.includes('download failed'));
    assert.deepEqual(notes.map((line) => line.trim()), ['- Hero Image (5:2): download failed for png at 3x (HTTP 404); not exported']);
});
