import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

// The render check's two comparisons with Figma: the widget's size and its children's positions against Figma's
// numbers, and the rendered image against Figma's own screenshot of the node. The tolerances and the reason for
// each are in tolerances.json.
final Map<String, dynamic> tolerances = jsonDecode(File('tolerances.json').readAsStringSync()) as Map<String, dynamic>;

/// A node's box in Figma: its offset from the rendered root, and its size.
class FigmaBox {
  const FigmaBox(this.id, this.x, this.y, this.width, this.height);
  final String id;
  final double x, y, width, height;
}

String _number(double value) => value == value.roundToDouble() ? value.toInt().toString() : value.toStringAsFixed(3);

/// One line per difference: `<node id> <axis>: Figma <n>, Flutter <m> (tolerance <t>)`.
/// The root is found by [root] and compared by size; each child by the [ValueKey] of its Figma node id, by offset and size.
List<String> boxDifferences(WidgetTester tester, Finder root, FigmaBox rootBox, List<FigmaBox> children) {
  final tolerance = (tolerances['positionPx'] as num).toDouble();
  final differences = <String>[];
  void compare(String id, String axis, double figma, double flutter) {
    if ((figma - flutter).abs() > tolerance) {
      differences.add('$id $axis: Figma ${_number(figma)}, Flutter ${_number(flutter)} (tolerance ${_number(tolerance)})');
    }
  }

  final rootRect = tester.getRect(root);
  compare(rootBox.id, 'width', rootBox.width, rootRect.width);
  compare(rootBox.id, 'height', rootBox.height, rootRect.height);
  for (final box in children) {
    final finder = find.byKey(ValueKey<String>(box.id));
    if (finder.evaluate().isEmpty) {
      differences.add('${box.id}: no widget with this key was built');
      continue;
    }
    final rect = tester.getRect(finder);
    compare(box.id, 'x', box.x, rect.left - rootRect.left);
    compare(box.id, 'y', box.y, rect.top - rootRect.top);
    compare(box.id, 'width', box.width, rect.width);
    compare(box.id, 'height', box.height, rect.height);
  }
  return differences;
}

/// Every comparison with Figma for one render, reported together so one failure does not hide another: the numbers,
/// Flutter's own layout errors, and, when [imageBoundary] and [screenshot] are given, the image against Figma's screenshot.
Future<void> expectRenderMatchesFigma(
  WidgetTester tester, {
  required Finder widget,
  required FigmaBox root,
  required List<FigmaBox> children,
  required List<String> flutterErrors,
  Finder? imageBoundary,
  String? screenshot,
}) async {
  final failures = <String>[...boxDifferences(tester, widget, root, children)];
  failures.addAll(flutterErrors.map((error) => '${root.id} Flutter error: $error'));
  if (imageBoundary != null && screenshot != null) {
    try {
      await expectLater(imageBoundary, matchesGoldenFile(screenshot));
    } on TestFailure catch (failure) {
      // matchesGoldenFile wraps the comparator's own message after "Which:".
      final message = failure.message ?? '';
      failures.add('${root.id} ${RegExp(r'Which: ([\s\S]*)').firstMatch(message)?.group(1)?.replaceAll(RegExp(r'\s+'), ' ') ?? message}');
    }
  }
  if (failures.isNotEmpty) fail(failures.join('\n'));
}

Future<({int width, int height, Uint8List rgba})> _decode(Uint8List png) async {
  final codec = await ui.instantiateImageCodec(png);
  final image = (await codec.getNextFrame()).image;
  final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
  return (width: image.width, height: image.height, rgba: data!.buffer.asUint8List());
}

/// Compares a render with Figma's screenshot, counting a pixel as different only when a channel differs by more
/// than `channelDelta`, and failing when more than `maxDifferingRatio` of the pixels differ. Flutter's own comparator
/// fails on any difference, which a Figma image never avoids (corner antialiasing, glyph offsets).
/// A failure saves the rendered image and the difference under failures/.
class FigmaScreenshotComparator extends LocalFileComparator {
  FigmaScreenshotComparator(super.testFile);

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final figma = await _decode(Uint8List.fromList(await getGoldenBytes(golden)));
    final flutter = await _decode(imageBytes);
    final name = golden.pathSegments.last.replaceAll('.png', '');
    if (figma.width != flutter.width || figma.height != flutter.height) {
      throw TestFailure('$name image size: Figma ${figma.width} x ${figma.height}, Flutter ${flutter.width} x ${flutter.height}');
    }
    final delta = (tolerances['channelDelta'] as num).toInt();
    final limit = (tolerances['maxDifferingRatio'] as num).toDouble();
    final diff = Uint8List(figma.rgba.length);
    var differing = 0;
    for (var i = 0; i < figma.rgba.length; i += 4) {
      var largest = 0;
      for (var c = 0; c < 4; c++) {
        final d = (figma.rgba[i + c] - flutter.rgba[i + c]).abs();
        if (d > largest) largest = d;
      }
      if (largest > delta) {
        differing++;
        diff[i] = 255;
        diff[i + 3] = 255;
      }
    }
    final ratio = differing / (figma.width * figma.height);
    // Printed on every comparison: the limit is set from these numbers (tolerances.json).
    // ignore: avoid_print
    print('$name image: ${(ratio * 100).toStringAsFixed(2)}% of pixels differ by more than $delta/255');
    if (ratio <= limit) return true;
    Directory('failures').createSync(recursive: true);
    File('failures/${name}_testImage.png').writeAsBytesSync(imageBytes);
    final completer = Completer<ui.Image>();
    ui.decodeImageFromPixels(diff, figma.width, figma.height, ui.PixelFormat.rgba8888, completer.complete);
    final png = await (await completer.future).toByteData(format: ui.ImageByteFormat.png);
    File('failures/${name}_isolatedDiff.png').writeAsBytesSync(png!.buffer.asUint8List());
    throw TestFailure('$name image: ${(ratio * 100).toStringAsFixed(2)}% of pixels differ from Figma by more than $delta/255 '
        '(limit ${(limit * 100).toStringAsFixed(2)}%); saved failures/${name}_testImage.png and failures/${name}_isolatedDiff.png');
  }

  @override
  Future<void> update(Uri golden, Uint8List imageBytes) =>
      throw StateError('${golden.pathSegments.last} is Figma\'s screenshot; recapture it with tools/render-check/capture-screenshots.mts, never with --update-goldens');
}
