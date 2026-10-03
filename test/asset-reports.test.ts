import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callToolOffline, FILE_KEY, type OfflineToolResult} from './helpers/offline-tool.ts';
import type {FakeResponse, FakeRoutes} from './helpers/fake-figma.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
const photo = (id: string, name: string) =>
    ({id, name, type: 'RECTANGLE', absoluteBoundingBox: box(100, 100), fills: [{type: 'IMAGE', imageRef: 'ref'}]});
const vector = (id: string, name: string, format: 'SVG' | 'PDF') =>
    ({id, name, type: 'VECTOR', absoluteBoundingBox: box(24, 24), fills: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}],
        exportSettings: [{suffix: '', format, constraint: {type: 'SCALE', value: 1}}]});

const FRAME = {id: '5:1', name: 'Screen', type: 'FRAME', absoluteBoundingBox: box(375, 812), children: [
    photo('5:2', 'My Logo'),
    photo('5:3', '404 Illustration'),
    vector('5:4', 'Mark', 'SVG'),
    vector('5:5', 'Doc', 'PDF'),
]};

/** Serves `roots` and one /images answer per [format, scale, ids] entry, with the rendered bytes. */
function figma(roots: Array<{id: string}>, renders: Array<{ids: string[]; format: 'png' | 'svg' | 'pdf'; scale?: number}>): FakeRoutes {
    return (baseUrl) => {
        const ids = roots.map((root) => root.id).join(',');
        const routes: Record<string, FakeResponse> = {
            [`/files/${FILE_KEY}/nodes?ids=${ids}`]: {body: {nodes: Object.fromEntries(roots.map((root) => [root.id, {document: root}]))}},
        };
        for (const {ids: renderIds, format, scale} of renders) {
            const query = scale === undefined ? `ids=${renderIds.join(',')}&format=${format}` : `ids=${renderIds.join(',')}&format=${format}&scale=${scale}`;
            routes[`/images/${FILE_KEY}?${query}`] = {body: {images: Object.fromEntries(renderIds.map((id) => [id, `${baseUrl}/render/${format}/${id}`]))}};
            for (const id of renderIds) routes[`/render/${format}/${id}`] = {body: format === 'svg' ? SVG : PNG};
        }
        return routes;
    };
}

const FRAME_RENDERS = [{ids: ['5:2', '5:3'], format: 'png' as const, scale: 2}, {ids: ['5:4'], format: 'svg' as const}, {ids: ['5:5'], format: 'pdf' as const}];
const PUBSPEC = 'name: my_shop\n\nflutter:\n  uses-material-design: true\n';
const PUBSPEC_FLUTTER_GEN = 'name: my_shop\n\ndev_dependencies:\n  flutter_gen_runner: ^5.0.0\n\nflutter:\n  uses-material-design: true\n';

async function tempProject(t: TestContext, pubspec: string | undefined, withThemeDir = true): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'figma-flutter-asset-reports-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    if (pubspec !== undefined) await writeFile(join(dir, 'pubspec.yaml'), pubspec);
    if (withThemeDir) await mkdir(join(dir, 'lib/theme'), {recursive: true});
    return dir;
}

const TOOLS = [
    ['analyze_figma_component', (dir: string) => ({input: FILE_KEY, nodeId: '5:1', userDefinedComponent: true, exportAssets: true, projectPath: dir, useDeduplication: false})],
    ['analyze_frame_as_screen', (dir: string) => ({input: FILE_KEY, nodeId: '5:1', extractAssets: true, projectPath: dir})],
] as const;

const run = (tool: typeof TOOLS[number], dir: string) => callToolOffline(figma([FRAME], FRAME_RENDERS), tool[0], tool[1](dir));

for (const tool of TOOLS) {
    test(`${tool[0]}: the report's import, class and constants are the ones written`, async (t) => {
        const dir = await tempProject(t, PUBSPEC_FLUTTER_GEN);
        const {text} = await run(tool, dir);

        assert.match(text, /import 'package:my_shop\/theme\/assets\.dart';/);
        assert.match(text, /import 'package:my_shop\/theme\/svg_assets\.dart';/);
        assert.match(text, /^\s*Image\.asset\(FigmaAssets\.myLogo\)/m);
        assert.match(text, /^\s*SvgPicture\.asset\(SvgAssets\.mark\)/m);
        assert.doesNotMatch(text, /your_app|lib\/constants/);
        const raster = await readFile(join(dir, 'lib/theme/assets.dart'), 'utf-8');
        assert.match(raster, /^class FigmaAssets \{$/m);
        assert.match(raster, /^  static const String myLogo = 'assets\/images\/my_logo\.png';$/m);
        const svg = await readFile(join(dir, 'lib/theme/svg_assets.dart'), 'utf-8');
        assert.match(svg, /^  static const String mark = 'assets\/svgs\/mark\.svg';$/m);
    });

    test(`${tool[0]}: resolution-variant files give no 20x names; an invalid layer name is reported, not renamed`, async (t) => {
        const dir = await tempProject(t, PUBSPEC);
        const {text} = await run(tool, dir);

        assert.doesNotMatch(text, /Assets\.20x|2_0x/);
        for (const [, identifier] of text.matchAll(/(?:Image|SvgPicture)\.asset\(\w+\.(\w+)\)/g)) {
            assert.match(identifier, /^[A-Za-z_$][A-Za-z0-9_$]*$/);
        }
        assert.match(text, /404 Illustration.*not a valid Dart identifier/);
        assert.doesNotMatch(text, /image404Illustration/);
        assert.equal((await readdir(join(dir, 'assets/images/2.0x'))).sort().join(), '404_illustration.png,my_logo.png');
    });

    test(`${tool[0]}: a PDF is listed with its path and gets no usage line`, async (t) => {
        const dir = await tempProject(t, PUBSPEC);
        const {text} = await run(tool, dir);

        assert.match(text, /assets\/svgs\/doc\.pdf/);
        assert.doesNotMatch(text, /asset\(\w+\.doc\)/);
    });

    test(`${tool[0]}: SVG usage says flutter pub add flutter_svg and pins no version`, async (t) => {
        const dir = await tempProject(t, PUBSPEC);
        const {text} = await run(tool, dir);

        assert.match(text, /flutter pub add flutter_svg/);
        assert.doesNotMatch(text, /\^2\.0\.0/);
    });

    test(`${tool[0]}: without pubspec.yaml the asset section names it and nothing is requested or written`, async (t) => {
        const dir = await tempProject(t, undefined, false);
        const {text, isError, requests} = await run(tool, dir);

        assert.equal(isError, false);
        assert.match(text, /pubspec\.yaml/);
        assert.equal(requests.some((request) => request.path.startsWith('/images')), false);
        assert.deepEqual(await readdir(dir), []);
    });
}

test('export_flutter_assets: the report names the written file and the pubspec package', async (t) => {
    const dir = await tempProject(t, PUBSPEC);
    const {text} = await callToolOffline(figma([photo('6:1', 'My Logo')], [{ids: ['6:1'], format: 'png', scale: 2}]), 'export_flutter_assets',
        {fileId: FILE_KEY, nodeIds: ['6:1'], projectPath: dir});

    assert.match(text, /import 'package:my_shop\/theme\/assets\.dart';/);
    assert.match(text, /^\s*Image\.asset\(Assets\.myLogo\)/m);
    assert.doesNotMatch(text, /your_app/);
    assert.match(await readFile(join(dir, 'lib/theme/assets.dart'), 'utf-8'), /^class Assets \{$/m);
});

test('export_svg_flutter_assets: the report names the written file and uses SvgPicture.asset', async (t) => {
    const dir = await tempProject(t, PUBSPEC);
    const {text} = await callToolOffline(figma([vector('7:1', 'Brand Mark', 'SVG')], [{ids: ['7:1'], format: 'svg'}]), 'export_svg_flutter_assets',
        {fileId: FILE_KEY, nodeIds: ['7:1'], projectPath: dir});

    assert.match(text, /import 'package:my_shop\/theme\/svg_assets\.dart';/);
    assert.match(text, /^\s*SvgPicture\.asset\(SvgAssets\.brandMark\)/m);
    assert.match(text, /flutter pub add flutter_svg/);
    assert.doesNotMatch(text, /\^2\.0\.0|your_app/);
    assert.match(await readFile(join(dir, 'lib/theme/svg_assets.dart'), 'utf-8'), /^class SvgAssets \{$/m);
});

const REFUSING: Array<[string, Record<string, unknown>]> = [
    ['export_flutter_assets', {fileId: FILE_KEY, nodeIds: ['6:1']}],
    ['export_svg_flutter_assets', {fileId: FILE_KEY, nodeIds: ['6:1']}],
    ['generate_golden_file_test', {widgetName: 'ContinueButton', widgetImportPath: 'widgets/continue_button.dart'}],
];
for (const [tool, args] of REFUSING) {
    test(`${tool}: without pubspec.yaml it errors naming the file, before any Figma call or write`, async (t) => {
        const dir = await tempProject(t, undefined, false);
        const result: OfflineToolResult = await callToolOffline(figma([photo('6:1', 'My Logo')], [{ids: ['6:1'], format: 'png', scale: 2}]), tool, {...args, projectPath: dir});

        assert.equal(result.isError, true);
        assert.match(result.text, /pubspec\.yaml/);
        assert.deepEqual(result.requests, []);
        assert.deepEqual(await readdir(dir), []);
    });
}
