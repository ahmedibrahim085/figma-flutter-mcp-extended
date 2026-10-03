#!/bin/bash
# Render check: generate Dart for one Figma node offline, analyse it, and render it in four hosts.
# Usage: npm run render-check -- [--theme | --typography] <fixture name in test/fixtures, or a path> <nodeId>
# --theme checks extract_theme_colors: its generated lib/theme (analysed with --fatal-infos) and the theme in four hosts.
# --typography checks extract_theme_typography: its generated lib/theme (analysed with --fatal-infos) and a Text in the first style, under its TextTheme, in four hosts.
# --assets checks the asset tools' report: in a temp copy of the harness with flutter_svg added (from the local pub cache), it exports a PNG and an SVG, then analyses and pumps the report's own import and usage lines in four hosts.
# Needs Flutter on PATH. Exits non-zero on any analyzer error or Flutter layout error.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
npm run build --silent
if [ "${1:-}" = "--assets" ]; then
    # The asset tools edit pubspec.yaml and write assets/ and lib/, so they get a copy, never the tracked harness.
    PROJECT="$(mktemp -d)"
    trap 'rm -rf "$PROJECT"' EXIT
    cp "$HERE/flutter/pubspec.yaml" "$HERE/flutter/analysis_options.yaml" "$PROJECT/"
    (cd "$PROJECT" && flutter pub add flutter_svg --offline >/dev/null)
    node --import tsx "$HERE/generate.mts" --assets "$PROJECT"
    cd "$PROJECT"
    flutter pub get --offline >/dev/null
    dart analyze --fatal-infos lib test
    flutter test test/asset_host_test.dart
    exit 0
fi
node --import tsx "$HERE/generate.mts" "$@"
cd "$HERE/flutter"
flutter pub get >/dev/null
if [ "${1:-}" = "--theme" ]; then
    dart analyze --fatal-infos lib/theme
    flutter test test/theme_host_test.dart
elif [ "${1:-}" = "--typography" ]; then
    dart analyze --fatal-infos lib/theme
    flutter test test/typography_host_test.dart
else
    dart analyze --fatal-warnings lib/generated.dart
    flutter test test/host_matrix_test.dart
fi
