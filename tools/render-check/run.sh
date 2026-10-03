#!/bin/bash
# Render check: generate Dart for one Figma node offline, analyse it, and render it in four hosts.
# Usage: npm run render-check -- [--theme | --typography] <fixture name in test/fixtures, or a path> <nodeId>
#        npm run render-check -- --assets
# --theme checks extract_theme_colors: its generated lib/theme (analysed with --fatal-infos) and the theme in four hosts.
# --typography checks extract_theme_typography: its generated lib/theme (analysed with --fatal-infos) and a Text in the first style, under its TextTheme, in four hosts.
# --assets checks the asset tools' report: in a temp copy of the harness with flutter_svg added (from the local pub cache), it exports a PNG and an SVG, then analyses and pumps the report's own import and usage lines in four hosts.
# Needs Flutter: `fvm flutter` when the harness has a .fvmrc (it pins the SDK; the Homebrew `flutter` on one machine exits 137 at start), else `flutter` on PATH.
# Exits non-zero on any analyzer error, Flutter layout error, or difference from Figma's numbers or screenshot.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
if [ -f "$HERE/flutter/.fvmrc" ]; then FLUTTER=(fvm flutter); DART=(fvm dart); else FLUTTER=(flutter); DART=(dart); fi
npm run build --silent
if [ "${1:-}" = "--assets" ]; then
    # The asset tools edit pubspec.yaml and write assets/ and lib/, so they get a copy, never the tracked harness.
    PROJECT="$(mktemp -d)"
    trap 'rm -rf "$PROJECT"' EXIT
    cp "$HERE/flutter/pubspec.yaml" "$HERE/flutter/analysis_options.yaml" "$PROJECT/"
    if [ -f "$HERE/flutter/.fvmrc" ]; then cp "$HERE/flutter/.fvmrc" "$PROJECT/"; fi
    (cd "$PROJECT" && "${FLUTTER[@]}" pub add flutter_svg --offline >/dev/null)
    node --import tsx "$HERE/generate.mts" --assets "$PROJECT"
    cd "$PROJECT"
    "${FLUTTER[@]}" pub get --offline >/dev/null
    "${DART[@]}" analyze --fatal-infos lib test
    "${FLUTTER[@]}" test test/asset_host_test.dart
    exit 0
fi
node --import tsx "$HERE/generate.mts" "$@"
cd "$HERE/flutter"
"${FLUTTER[@]}" pub get >/dev/null
if [ "${1:-}" = "--theme" ]; then
    "${DART[@]}" analyze --fatal-infos lib/theme
    "${FLUTTER[@]}" test test/theme_host_test.dart
elif [ "${1:-}" = "--typography" ]; then
    "${DART[@]}" analyze --fatal-infos lib/theme
    "${FLUTTER[@]}" test test/typography_host_test.dart
else
    "${DART[@]}" analyze --fatal-warnings lib/generated.dart
    "${FLUTTER[@]}" test test/host_matrix_test.dart
fi
