// Render check, step 1: run the code generator offline on one Figma node and write a Dart
// library plus a widget test that pumps it in four hosts.
// Usage: node --import tsx tools/render-check/generate.mts [--theme] <fixture name in test/fixtures, or a path> <nodeId>
// --theme runs extract_theme_colors instead: lib/theme gets app_colors.dart and app_theme.dart, and a test pumps
// MaterialApp(theme: AppTheme.lightTheme) in the four hosts.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isAbsolute, resolve} from 'node:path';
import {callToolsOffline, nodeRoute, FILE_KEY} from '../../test/helpers/offline-tool.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FLUTTER = fileURLToPath(new URL('./flutter/', import.meta.url));

const args = process.argv.slice(2);
const themeMode = args[0] === '--theme';
const [fixture, nodeId] = themeMode ? args.slice(1) : args;
if (!fixture || !nodeId) {
    console.error('usage: generate.mts [--theme] <fixture name or path> <nodeId>');
    process.exit(2);
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

const HOSTS = `<String, Widget Function(Widget)>{
    'bounded': (w) => Align(alignment: Alignment.topLeft, child: w),
    'horizontal scroll': (w) => SingleChildScrollView(scrollDirection: Axis.horizontal, child: w),
    'vertical scroll': (w) => SingleChildScrollView(child: w),
    'row': (w) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [w]),
  }`;

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

const [analysis, implementation] = await callToolsOffline(nodeRoute(node.id, node), [
    ['analyze_figma_component', {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true}],
    ['generate_flutter_implementation', {componentNodeId: node.id}],
]);
// The widget class comes from the analysis; the style constants it refers to come from the implementation.
const styleDefinitions = [...implementation.text.matchAll(/^final \w+ = [\s\S]*?;$/gm)].map((m) => m[0]).join('\n');
const classStart = analysis.text.indexOf('class ');
const classEnd = analysis.text.indexOf('\n}\n', classStart) + 3;
if (classStart < 0 || classEnd < 3) {
    console.error('no widget class in the analyze_figma_component output:\n' + analysis.text);
    process.exit(1);
}
const widgetClass = analysis.text.slice(classStart, classEnd);
// The test screen is the node's own Figma size, so a host gives it exactly the room the design has.
// Without a Figma box the test keeps flutter_test's default view.
const box = node.absoluteBoundingBox;
const viewSetup = box
    ? `tester.view.physicalSize = const Size(${Math.ceil(box.width)}, ${Math.ceil(box.height)});\n      tester.view.devicePixelRatio = 1;\n      addTearDown(tester.view.reset);\n      `
    : '';
const className = widgetClass.match(/^class (\w+) /)![1];

// Git does not keep empty folders, so a fresh clone has neither lib/ nor test/ here.
mkdirSync(resolve(FLUTTER, 'lib'), {recursive: true});
mkdirSync(resolve(FLUTTER, 'test'), {recursive: true});
writeFileSync(resolve(FLUTTER, 'lib/generated.dart'),
    `import 'package:flutter/material.dart';\n\n${styleDefinitions}\n\n${widgetClass}`);
writeFileSync(resolve(FLUTTER, 'test/host_matrix_test.dart'), `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:render_check/generated.dart';

// The generated widget must lay out without a Flutter error in each host a screen can give it.
void main() {
  final hosts = <String, Widget Function(Widget)>{
    'bounded': (w) => Align(alignment: Alignment.topLeft, child: w),
    'horizontal scroll': (w) => SingleChildScrollView(scrollDirection: Axis.horizontal, child: w),
    'vertical scroll': (w) => SingleChildScrollView(child: w),
    'row': (w) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [w]),
  };
  for (final host in hosts.entries) {
    testWidgets('${className} in a \${host.key} host', (tester) async {
      ${viewSetup}final errors = <String>[];
      final previous = FlutterError.onError;
      FlutterError.onError = (details) => errors.add(details.exceptionAsString().split('\\n').first);
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: host.value(const ${className}()))));
      FlutterError.onError = previous;
      final size = tester.getSize(find.byType(${className}));
      // ignore: avoid_print
      print('\${host.key}: \${size.width} x \${size.height}');
      expect(errors, isEmpty);
    });
  }
}
`);
// The analysis text after the class lists approximations and notes; they belong next to the render result.
console.log(analysis.text.slice(classEnd).trim());
console.log(`\nwrote ${className} to tools/render-check/flutter/lib/generated.dart`);
