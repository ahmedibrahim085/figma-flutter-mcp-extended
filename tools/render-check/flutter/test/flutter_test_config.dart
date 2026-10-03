import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'figma_checks.dart';

// Every test in this project runs with the design's fonts loaded, as Figma draws them, and with the image
// comparison against Figma's screenshots. Loading fonts inside testWidgets hung (research 04 section 5), so it
// happens here, once, before any test. The fonts are listed in fonts/fonts.json.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  final fonts = jsonDecode(File('fonts/fonts.json').readAsStringSync())['fonts'] as List<dynamic>;
  final families = <String, FontLoader>{};
  for (final font in fonts) {
    final bytes = Uint8List.fromList(File('fonts/${font['file']}').readAsBytesSync());
    families.putIfAbsent(font['family'] as String, () => FontLoader(font['family'] as String)).addFont(Future.value(ByteData.sublistView(bytes)));
  }
  for (final loader in families.values) {
    await loader.load();
  }
  goldenFileComparator = FigmaScreenshotComparator(Uri.file('${Directory.current.path}/test/flutter_test_config.dart'));
  await testMain();
}
