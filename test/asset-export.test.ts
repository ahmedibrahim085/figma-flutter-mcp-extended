import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// SHORTCUT: js-yaml comes in through @changesets, not as a direct dependency.
// Add it to devDependencies if that chain ever drops it.
import yaml from 'js-yaml';
import {callToolOffline, FILE_KEY} from './helpers/offline-tool.ts';
import type {FakeResponse, FakeRoutes} from './helpers/fake-figma.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

const image = (id: string, name: string) => ({id, name, type: 'RECTANGLE', fills: [{type: 'IMAGE', imageRef: 'ref'}]});
const vector = (id: string, name: string) => ({id, name, type: 'VECTOR', fills: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}]});
const HERO = image('2:1', 'Hero Image');

type Format = 'png' | 'jpg' | 'svg';

const FLUTTER_CREATE_PUBSPEC = `name: app

dependencies:
  flutter:
    sdk: flutter

flutter:
  uses-material-design: true
`;

/** A temp Flutter project, removed when the test ends. */
async function tempProject(t: TestContext, pubspec?: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'figma-flutter-assets-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    if (pubspec !== undefined) await writeFile(join(dir, 'pubspec.yaml'), pubspec);
    return dir;
}

/** Serves `nodes`, their render URLs per scale, and the rendered bytes, all from the fake. */
function renderRoutes(nodes: Array<{id: string}>, format: Format, scales: number[]): FakeRoutes {
    const ids = nodes.map((n) => n.id).join(',');
    return (baseUrl) => {
        const routes: Record<string, FakeResponse> = {
            [`/files/${FILE_KEY}/nodes?ids=${ids}`]: {
                body: {nodes: Object.fromEntries(nodes.map((n) => [n.id, {document: n}]))},
            },
        };
        for (const scale of scales) {
            // Figma takes `scale` for raster formats only.
            const query = format === 'svg' ? `ids=${ids}&format=svg` : `ids=${ids}&format=${format}&scale=${scale}`;
            routes[`/images/${FILE_KEY}?${query}`] = {
                body: {images: Object.fromEntries(nodes.map((n) => [n.id, `${baseUrl}/render/${scale}/${n.id}`]))},
            };
            for (const n of nodes) routes[`/render/${scale}/${n.id}`] = {body: format === 'svg' ? SVG : PNG};
        }
        return routes;
    };
}

async function exportImages(dir: string, nodes: Array<{id: string}>, args: {format?: Format; devicePixelRatios?: number[]} = {}) {
    const scales = args.devicePixelRatios ?? [2];
    return callToolOffline(renderRoutes(nodes, args.format ?? 'png', scales), 'export_flutter_assets',
        {fileId: FILE_KEY, nodeIds: nodes.map((n) => n.id), projectPath: dir, ...args});
}

/** The pubspec text; parsing it proves every write left valid YAML. */
async function readPubspec(dir: string): Promise<{text: string; doc: any}> {
    const text = await readFile(join(dir, 'pubspec.yaml'), 'utf-8');
    return {text, doc: yaml.load(text)};
}

test('assets go under the top-level flutter block, not dependencies: flutter:', async (t) => {
    const dir = await tempProject(t, FLUTTER_CREATE_PUBSPEC);
    const {text} = await exportImages(dir, [HERO]);

    assert.match(text, /Successfully exported 1 image assets/);
    const pubspec = await readPubspec(dir);
    assert.equal(pubspec.text, `name: app

dependencies:
  flutter:
    sdk: flutter

flutter:
  assets:
    - assets/images/hero_image.png
  uses-material-design: true
`);
    assert.deepEqual(pubspec.doc.dependencies, {flutter: {sdk: 'flutter'}});
});

test('a 2x render lands in the 2.0x variant folder; the pubspec lists the main path', async (t) => {
    const dir = await tempProject(t, FLUTTER_CREATE_PUBSPEC);
    await exportImages(dir, [HERO], {devicePixelRatios: [2]});

    assert.deepEqual(await readFile(join(dir, 'assets/images/2.0x/hero_image.png')), PNG);
    assert.equal(existsSync(join(dir, 'assets/images/hero_image.png')), false);
    assert.equal(existsSync(join(dir, 'assets/images/hero_image@2x.png')), false);
    assert.deepEqual((await readPubspec(dir)).doc.flutter.assets, ['assets/images/hero_image.png']);
});

test('multiple device pixel ratios write 1x, 2.0x and 3.0x and declare the main path once', async (t) => {
    const dir = await tempProject(t, FLUTTER_CREATE_PUBSPEC);
    await exportImages(dir, [HERO], {devicePixelRatios: [1, 2, 3]});

    for (const file of ['hero_image.png', '2.0x/hero_image.png', '3.0x/hero_image.png']) {
        assert.deepEqual(await readFile(join(dir, 'assets/images', file)), PNG, file);
    }
    assert.deepEqual((await readPubspec(dir)).doc.flutter.assets, ['assets/images/hero_image.png']);
});

test('an existing block list keeps its entries and comments; new paths append after them', async (t) => {
    const dir = await tempProject(t, `name: app

flutter:
  uses-material-design: true
  # brand assets
  assets:
    - assets/icons/logo.png  # from the brand kit

  fonts: []
`);
    await exportImages(dir, [HERO]);

    const pubspec = await readPubspec(dir);
    assert.equal(pubspec.text, `name: app

flutter:
  uses-material-design: true
  # brand assets
  assets:
    - assets/icons/logo.png  # from the brand kit
    - assets/images/hero_image.png

  fonts: []
`);
    assert.deepEqual(pubspec.doc.flutter.fonts, []);
});

test('a directory entry covers the export only when the main file exists', async (t) => {
    const withDirectory = `name: app

flutter:
  assets:
    - assets/images/
`;
    const covered = await tempProject(t, withDirectory);
    await exportImages(covered, [HERO], {devicePixelRatios: [1, 2, 3]});
    assert.equal((await readPubspec(covered)).text, withDirectory);

    // Only 2.0x/hero_image.png exists: Flutter bundles nothing from the directory entry.
    const variantOnly = await tempProject(t, withDirectory);
    await exportImages(variantOnly, [HERO], {devicePixelRatios: [2]});
    assert.deepEqual((await readPubspec(variantOnly)).doc.flutter.assets,
        ['assets/images/', 'assets/images/hero_image.png']);
});

test('a flutter_gen block keeps its own assets: key; constants use the FigmaAssets class', async (t) => {
    const flutterGen = `name: app

dev_dependencies:
  flutter_gen_runner: ^5.0.0

flutter_gen:
  output: lib/gen/
  assets:
    outputs:
      class_name: Assets

flutter:
  uses-material-design: true
`;
    const dir = await tempProject(t, flutterGen);
    await exportImages(dir, [HERO]);

    const pubspec = await readPubspec(dir);
    assert.deepEqual(pubspec.doc.flutter_gen, (yaml.load(flutterGen) as any).flutter_gen);
    assert.deepEqual(pubspec.doc.flutter.assets, ['assets/images/hero_image.png']);
    const constants = await readFile(join(dir, 'lib/constants/assets.dart'), 'utf-8');
    assert.match(constants, /^class FigmaAssets \{$/m);
    assert.doesNotMatch(constants, /^class Assets \{$/m);
});

test('a pubspec without a flutter block gets one appended', async (t) => {
    const dir = await tempProject(t, 'name: app\n');
    await exportImages(dir, [HERO]);

    assert.equal((await readPubspec(dir)).text, `name: app

flutter:
  assets:
    - assets/images/hero_image.png
`);
});

test('a CRLF pubspec stays CRLF', async (t) => {
    const dir = await tempProject(t, FLUTTER_CREATE_PUBSPEC.replace(/\n/g, '\r\n'));
    await exportImages(dir, [HERO]);

    const pubspec = await readPubspec(dir);
    assert.equal(pubspec.text, `name: app

dependencies:
  flutter:
    sdk: flutter

flutter:
  assets:
    - assets/images/hero_image.png
  uses-material-design: true
`.replace(/\n/g, '\r\n'));
    assert.deepEqual(pubspec.doc.flutter.assets, ['assets/images/hero_image.png']);
});

for (const [shape, pubspec, reason] of [
    ['a flow-mapping flutter:', 'name: app\nflutter: {uses-material-design: true}\n', 'top-level flutter: is not a block mapping'],
    ['a scalar assets:', 'name: app\nflutter:\n  assets: assets/icons/\n', 'assets: is not a block list or a one-line flow list'],
    ['a multi-line flow assets:', 'name: app\nflutter:\n  assets: [\n    assets/icons/,\n  ]\n', 'assets: is not a block list or a one-line flow list'],
    ['map-form asset entries', 'name: app\nflutter:\n  assets:\n    - path: assets/icons/\n      flavors:\n        - free\n', 'asset entries use the map form'],
] as const) {
    test(`${shape} is refused: pubspec byte-identical, error names the lines to add`, async (t) => {
        const dir = await tempProject(t, pubspec);
        const {text} = await exportImages(dir, [HERO]);

        assert.equal(text, `Error exporting assets: pubspec.yaml left unchanged (${reason}). Add these under flutter: assets: assets/images/hero_image.png`);
        assert.equal(await readFile(join(dir, 'pubspec.yaml'), 'utf-8'), pubspec);
        // Constants are written before the pubspec edit, so a refusal does not lose them.
        assert.match(await readFile(join(dir, 'lib/constants/assets.dart'), 'utf-8'),
            /^  static const String heroImage = 'assets\/images\/hero_image\.png';$/m);
    });
}

test('constants keep the real extension; a layer name that is not a Dart identifier gets none, and the report says so', async (t) => {
    const dir = await tempProject(t, FLUTTER_CREATE_PUBSPEC);
    const {text} = await exportImages(dir, [HERO, image('2:2', '404 Illustration'), image('2:3', 'Default')], {format: 'jpg'});

    assert.equal(await readFile(join(dir, 'lib/constants/assets.dart'), 'utf-8'), `// Generated asset constants
// Do not edit manually

class Assets {
  static const String heroImage = 'assets/images/hero_image.jpg';
}
`);
    // The files are still written and listed; the report names each missing constant with its reason.
    assert.deepEqual(await readFile(join(dir, 'assets/images/2.0x/404_illustration.jpg')), PNG);
    assert.match(text, /404 Illustration \(assets\/images\/404_illustration\.jpg\): not a valid Dart identifier/);
    assert.match(text, /Default \(assets\/images\/default\.jpg\): not a valid Dart identifier/);
});

test('export_svg_flutter_assets writes the SVG, its constant, and the pubspec entry', async (t) => {
    const dir = await tempProject(t, FLUTTER_CREATE_PUBSPEC);
    const brandMark = vector('3:1', 'Brand Mark');
    const {text} = await callToolOffline(renderRoutes([brandMark], 'svg', [1]), 'export_svg_flutter_assets',
        {fileId: FILE_KEY, nodeIds: [brandMark.id], projectPath: dir});

    assert.match(text, /Successfully exported 1 SVG assets/);
    assert.deepEqual(await readFile(join(dir, 'assets/svgs/brand_mark.svg')), SVG);
    const pubspec = await readPubspec(dir);
    assert.deepEqual(pubspec.doc.flutter.assets, ['assets/svgs/brand_mark.svg']);
    assert.deepEqual(pubspec.doc.dependencies, {flutter: {sdk: 'flutter'}});
    assert.match(await readFile(join(dir, 'lib/constants/svg_assets.dart'), 'utf-8'),
        /^  static const String brandMark = 'assets\/svgs\/brand_mark\.svg';$/m);
});
