// Render check, step 1: run the code generator offline on one Figma node and write a Dart
// library plus a widget test that pumps it in four hosts.
// Usage: node --import tsx tools/render-check/generate.mts [--theme | --typography] <fixture name in test/fixtures, or a path> <nodeId>
//        node --import tsx tools/render-check/generate.mts --assets <Flutter project dir>
// --theme runs extract_theme_colors instead: lib/theme gets app_colors.dart and app_theme.dart, and a test pumps
// MaterialApp(theme: AppTheme.lightTheme) in the four hosts.
// --typography runs extract_theme_typography: lib/theme gets app_text.dart and, when a style is named like a TextTheme
// slot, text_theme.dart; a test pumps a Text in AppText's first style under that TextTheme in the four hosts.
// --assets runs analyze_frame_as_screen on a frame with a raster image and an SVG, with real image bytes, in the given
// project (run.sh passes a temp copy of the harness with flutter_svg added); a test pumps each Image.asset /
// SvgPicture.asset line of the report, using the report's own import lines, in the four hosts.
// Default mode compares the render with Figma (decision 26): in each host the widget's size and its children's
// positions against the fixture's numbers (children are found by a ValueKey holding their Figma node id, which
// only this check asks the generator for), and, in the bounded host, the image against Figma's own screenshot
// of the node (test/fixtures/screenshots). Tolerances: tools/render-check/flutter/tolerances.json.
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isAbsolute, resolve} from 'node:path';
import {callToolsOffline, nodeRoute, FILE_KEY} from '../../test/helpers/offline-tool.ts';
import {startFakeFigma} from '../../test/helpers/fake-figma.ts';
import {FigmaService} from '../../src/services/figma.ts';
import {DeduplicatedComponentExtractor} from '../../src/extractors/components/deduplicated-extractor.ts';
import {generateFlutterImplementation, referencedStyles, withNodeKeys} from '../../src/tools/flutter/components/deduplicated-helpers.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FLUTTER = fileURLToPath(new URL('./flutter/', import.meta.url));

const args = process.argv.slice(2);
const assetsMode = args[0] === '--assets';
const themeMode = args[0] === '--theme';
const typographyMode = args[0] === '--typography';
const [fixture, nodeId] = themeMode || typographyMode || assetsMode ? args.slice(1) : args;
if (assetsMode ? !fixture : !fixture || !nodeId) {
    console.error('usage: generate.mts [--theme | --typography] <fixture name or path> <nodeId> | --assets <Flutter project dir>');
    process.exit(2);
}
const HOSTS = `<String, Widget Function(Widget)>{
    'bounded': (w) => Align(alignment: Alignment.topLeft, child: w),
    'horizontal scroll': (w) => SingleChildScrollView(scrollDirection: Axis.horizontal, child: w),
    'vertical scroll': (w) => SingleChildScrollView(child: w),
    'row': (w) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [w]),
  }`;

if (assetsMode) {
    // A 1x1 PNG and a 24x24 SVG: the host decodes and draws them, so they must be real images.
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#000000"/></svg>');
    const box = {x: 0, y: 0, width: 100, height: 100};
    const frame = {id: '1:1', name: 'Screen', type: 'FRAME', absoluteBoundingBox: {x: 0, y: 0, width: 375, height: 812}, children: [
        {id: '1:2', name: 'My Logo', type: 'RECTANGLE', absoluteBoundingBox: box, fills: [{type: 'IMAGE', imageRef: 'ref'}]},
        {id: '1:3', name: 'Mark', type: 'VECTOR', absoluteBoundingBox: box, fills: [{type: 'SOLID', color: {r: 0, g: 0, b: 0, a: 1}}],
            exportSettings: [{suffix: '', format: 'SVG', constraint: {type: 'SCALE', value: 1}}]},
    ]};
    const renders = [{ids: ['1:2'], format: 'png', query: 'format=png&scale=2', bytes: PNG}, {ids: ['1:3'], format: 'svg', query: 'format=svg', bytes: SVG}];
    const [result] = await callToolsOffline((baseUrl) => ({
        ...nodeRoute(frame.id, frame),
        ...Object.fromEntries(renders.flatMap(({ids, format, query, bytes}) => [
            [`/images/${FILE_KEY}?ids=${ids.join(',')}&${query}`, {body: {images: Object.fromEntries(ids.map((id) => [id, `${baseUrl}/render/${id}`]))}}],
            ...ids.map((id) => [`/render/${id}`, {body: bytes}]),
        ])),
    }), [['analyze_frame_as_screen', {input: FILE_KEY, nodeId: frame.id, extractAssets: true, projectPath: fixture}]]);

    // The test is built only from the report's own lines, so it proves those lines compile and draw.
    const imports = [...result.text.matchAll(/^(?:Import: )?(import '[^']+';)/gm)].map((m) => m[1]);
    const usages = [...result.text.matchAll(/^\s+((?:Image|SvgPicture)\.asset\(\w+\.\w+\))/gm)].map((m) => m[1]);
    if (usages.length !== 2) {
        console.error(`expected two usage lines in the report, found ${usages.length}:\n${result.text}`);
        process.exit(1);
    }
    mkdirSync(resolve(fixture, 'test'), {recursive: true});
    writeFileSync(resolve(fixture, 'test/asset_host_test.dart'), `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
${[...new Set(imports)].join('\n')}

// Each usage line of the asset report must build, load its file and lay out without a Flutter error in each host.
void main() {
  final hosts = ${HOSTS};
  final assets = <String, Widget Function()>{
${usages.map((usage) => `    '${usage}': () => ${usage},`).join('\n')}
  };
  for (final asset in assets.entries) {
    for (final host in hosts.entries) {
      testWidgets('\${asset.key} in a \${host.key} host', (tester) async {
        final errors = <String>[];
        final previous = FlutterError.onError;
        FlutterError.onError = (details) => errors.add(details.exceptionAsString().split('\\n').first);
        await tester.runAsync(() async {
          await tester.pumpWidget(MaterialApp(home: Scaffold(body: host.value(SizedBox(width: 40, height: 40, child: asset.value())))));
          await Future<void>.delayed(const Duration(milliseconds: 200));
        });
        await tester.pump();
        FlutterError.onError = previous;
        // ignore: avoid_print
        print('\${asset.key} / \${host.key}: \${tester.getSize(find.byType(SizedBox).last)}');
        expect(errors, isEmpty);
      });
    }
  }
}
`);
    console.log(result.text);
    console.log(`\nwrote the project and test/asset_host_test.dart in ${fixture}`);
    process.exit(0);
}

const fixturePath = isAbsolute(fixture) ? fixture : resolve(ROOT, 'test/fixtures', fixture);
if (!existsSync(fixturePath)) {
    console.error(`fixture not found: ${fixturePath}`);
    process.exit(2);
}
const payload = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const find = (node: any): any => node.id === nodeId ? node : (node.children ?? []).map(find).find(Boolean);
const node = (Object.values(payload.nodes) as any[]).map((entry) => find(entry.document)).find(Boolean);
if (!node) {
    console.error(`node ${nodeId} not found in ${fixturePath}`);
    process.exit(2);
}

if (themeMode) {
    // The theme tool writes into <projectPath>/lib/theme; the harness is the project.
    const entry = (Object.values(payload.nodes) as any[]).find((e) => find(e.document));
    const [result] = await callToolsOffline(nodeRoute(node.id, node, entry.styles), [
        ['extract_theme_colors', {fileId: FILE_KEY, nodeId: node.id, projectPath: FLUTTER, generateThemeData: true}],
    ]);
    if (!result.text.startsWith('Successfully')) {
        console.error(result.text);
        process.exit(1);
    }
    const firstColor = readFileSync(resolve(FLUTTER, 'lib/theme/app_colors.dart'), 'utf-8').match(/static const Color (\w+) =/)![1];
    mkdirSync(resolve(FLUTTER, 'test'), {recursive: true});
    writeFileSync(resolve(FLUTTER, 'test/theme_host_test.dart'), `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:render_check/theme/app_colors.dart';
import 'package:render_check/theme/app_theme.dart';

// The generated theme must build and lay out without a Flutter error in each host a screen can give it.
void main() {
  final hosts = ${HOSTS};
  for (final host in hosts.entries) {
    testWidgets('AppTheme.lightTheme in a \${host.key} host', (tester) async {
      final errors = <String>[];
      final previous = FlutterError.onError;
      FlutterError.onError = (details) => errors.add(details.exceptionAsString().split('\\n').first);
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(body: host.value(const SizedBox(width: 40, height: 40, child: ColoredBox(color: AppColors.${firstColor})))),
      ));
      FlutterError.onError = previous;
      // ignore: avoid_print
      print('\${host.key}: \${tester.getSize(find.byWidgetPredicate((w) => w is ColoredBox && w.color == AppColors.${firstColor}))}');
      expect(errors, isEmpty);
    });
  }
}
`);
    console.log(result.text);
    console.log('\nwrote lib/theme and test/theme_host_test.dart in tools/render-check/flutter');
    process.exit(0);
}

if (typographyMode) {
    // The theme tool writes into <projectPath>/lib/theme; the harness is the project. Files of an earlier run would be analysed too.
    rmSync(resolve(FLUTTER, 'lib/theme'), {recursive: true, force: true});
    const entry = (Object.values(payload.nodes) as any[]).find((e) => find(e.document));
    const [result] = await callToolsOffline(nodeRoute(node.id, node, entry.styles), [
        ['extract_theme_typography', {fileId: FILE_KEY, nodeId: node.id, projectPath: FLUTTER, generateTextTheme: true}],
    ]);
    if (!result.text.startsWith('Successfully')) {
        console.error(result.text);
        process.exit(1);
    }
    const firstStyle = readFileSync(resolve(FLUTTER, 'lib/theme/app_text.dart'), 'utf-8').match(/static const TextStyle (\S+) =/)![1];
    const hasTextTheme = existsSync(resolve(FLUTTER, 'lib/theme/text_theme.dart'));
    mkdirSync(resolve(FLUTTER, 'test'), {recursive: true});
    writeFileSync(resolve(FLUTTER, 'test/typography_host_test.dart'), `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:render_check/theme/app_text.dart';
${hasTextTheme ? "import 'package:render_check/theme/text_theme.dart';\n" : ''}
// The generated text styles must build and lay out without a Flutter error in each host a screen can give them.
void main() {
  final hosts = ${HOSTS};
  for (final host in hosts.entries) {
    testWidgets('AppText.${firstStyle} in a \${host.key} host', (tester) async {
      final errors = <String>[];
      final previous = FlutterError.onError;
      FlutterError.onError = (details) => errors.add(details.exceptionAsString().split('\\n').first);
      await tester.pumpWidget(MaterialApp(
        theme: ThemeData(${hasTextTheme ? 'textTheme: AppTextTheme.textTheme' : ''}),
        home: Scaffold(body: host.value(const Text('Sample', style: AppText.${firstStyle}))),
      ));
      FlutterError.onError = previous;
      // ignore: avoid_print
      print('\${host.key}: \${tester.getSize(find.text('Sample'))}');
      expect(errors, isEmpty);
    });
  }
}
`);
    console.log(result.text);
    console.log('\nwrote lib/theme and test/typography_host_test.dart in tools/render-check/flutter');
    process.exit(0);
}

// The generator is called the way generate_flutter_implementation calls it, with one addition: withNodeKeys, so each
// child carries the id of its Figma node. The node arrives through FigmaService from a fake Figma, as in the tool.
const fakeFigma = await startFakeFigma(nodeRoute(node.id, node));
// The Figma cache is off, as in the test harness: the fake serves the node only, not the file's /meta.
const previous = {base: process.env.FIGMA_API_BASE_URL, cache: process.env.FIGMA_CACHE};
process.env.FIGMA_API_BASE_URL = fakeFigma.baseUrl;
process.env.FIGMA_CACHE = 'off';
let document;
try {
    ({document} = await new FigmaService('test-key').getNodeWithStyles(FILE_KEY, node.id));
} finally {
    for (const [name, value] of [['FIGMA_API_BASE_URL', previous.base], ['FIGMA_CACHE', previous.cache]] as const) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await fakeFigma.close();
}
if (document.type === 'COMPONENT_SET') {
    console.error(`${node.id} is a component set; the render check renders one component at a time`);
    process.exit(2);
}
const extractor = new DeduplicatedComponentExtractor();
const analysis = await extractor.analyzeComponent(document, true);
const implementation = withNodeKeys(() => generateFlutterImplementation(analysis, extractor.styleLibrary));

// Every font a text node names must be one the harness loads (fonts/fonts.json), or Flutter would silently use its test font.
const loaded = JSON.parse(readFileSync(resolve(FLUTTER, 'fonts/fonts.json'), 'utf-8')).fonts as Array<{family: string; weight: number}>;
const missing = new Set<string>();
(function checkFonts(n: any) {
    const {fontFamily, fontWeight} = n.style ?? {};
    if (fontFamily && !loaded.some((font) => font.family === fontFamily && font.weight === fontWeight)) missing.add(`${fontFamily} w${fontWeight}`);
    (n.children ?? []).forEach(checkFonts);
})(node);
if (missing.size > 0) {
    console.error(`font ${[...missing].join(', ')} not loaded: add the file to tools/render-check/flutter/fonts/ and list it in fonts.json`);
    process.exit(1);
}

// The widget class and the style constants it refers to both come from generate_flutter_implementation.
const styleDefinitions = referencedStyles(implementation, extractor.styleLibrary).map((style) => `final ${style.id} = ${style.flutterCode};`).join('\n');
const classStart = implementation.indexOf('class ');
const classEnd = implementation.indexOf('\n}\n', classStart) + 3;
if (classStart < 0 || classEnd < 3) {
    console.error('no widget class in the generate_flutter_implementation output:\n' + implementation);
    process.exit(1);
}
const widgetClass = implementation.slice(classStart, classEnd);
const className = widgetClass.match(/^class (\w+) /)![1];

// Figma's numbers: the root's size, and each keyed child's offset from the root and its size (absoluteBoundingBox).
const box = node.absoluteBoundingBox;
if (!box) {
    console.error(`${node.id} has no absoluteBoundingBox in the fixture, so there is nothing to compare with`);
    process.exit(2);
}
const keyed = [...new Set([...widgetClass.matchAll(/ValueKey\('([^']+)'\)/g)].map((m) => m[1]))];
const dartBox = (id: string, b: {x: number; y: number; width: number; height: number}) =>
    `FigmaBox('${id}', ${b.x - box.x}, ${b.y - box.y}, ${b.width}, ${b.height})`;
const byId = (n: any, id: string): any => n.id === id ? n : (n.children ?? []).map((c: any) => byId(c, id)).find(Boolean);
const childBoxes = keyed.flatMap((id) => {
    const child = byId(node, id);
    if (child?.absoluteBoundingBox) return [`    ${dartBox(id, child.absoluteBoundingBox)},`];
    console.log(`not compared: ${id} is keyed in the generated widget but has no absoluteBoundingBox in the fixture`);
    return [];
});

// Figma's screenshot of this node, when the manifest has one.
const manifestPath = resolve(ROOT, 'test/fixtures/screenshots/manifest.json');
const shot = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8')).screenshots.find((s: any) => s.nodeId === node.id) : undefined;

// The test screen is the node's own Figma size, so a host gives it exactly the room the design has.
const viewSetup = `tester.view.physicalSize = const Size(${Math.ceil(box.width)}, ${Math.ceil(box.height)});\n      tester.view.devicePixelRatio = 1;\n      addTearDown(tester.view.reset);\n      `;

// Git does not keep empty folders, so a fresh clone has neither lib/ nor test/ here.
mkdirSync(resolve(FLUTTER, 'lib'), {recursive: true});
mkdirSync(resolve(FLUTTER, 'test'), {recursive: true});
writeFileSync(resolve(FLUTTER, 'lib/generated.dart'),
    `import 'package:flutter/material.dart';\n\n${styleDefinitions}\n\n${widgetClass}`);
writeFileSync(resolve(FLUTTER, 'test/host_matrix_test.dart'), `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:render_check/generated.dart';

import 'figma_checks.dart';

// The generated widget must lay out without a Flutter error in each host a screen can give it, match Figma's
// numbers there, and, in the bounded host, match Figma's screenshot of the node.
void main() {
  const root = ${dartBox(node.id, box)};
  const children = <FigmaBox>[
${childBoxes.join('\n')}
  ];
  final hosts = ${HOSTS};
  for (final host in hosts.entries) {
    testWidgets('${className} in a \${host.key} host', (tester) async {
      ${viewSetup}final errors = <String>[];
      final previous = FlutterError.onError;
      FlutterError.onError = (details) => errors.add(details.exceptionAsString().split('\\n').first);
      await tester.pumpWidget(MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(body: host.value(const RepaintBoundary(key: ValueKey('render-check-image'), child: ${className}()))),
      ));
      FlutterError.onError = previous;
      final size = tester.getSize(find.byType(${className}));
      // ignore: avoid_print
      print('\${host.key}: \${size.width} x \${size.height}');
      await expectRenderMatchesFigma(
        tester,
        widget: find.byType(${className}),
        root: root,
        children: children,
        flutterErrors: errors,${shot ? `
        imageBoundary: host.key == 'bounded' ? find.byKey(const ValueKey('render-check-image')) : null,
        screenshot: '../../../../test/fixtures/screenshots/${shot.file}',` : ''}
      );
    });
  }
}
`);
// The text after the class lists approximations and notes; they belong next to the render result.
console.log(implementation.slice(classEnd).trim());
console.log(`\nwrote ${className} to tools/render-check/flutter/lib/generated.dart`);
