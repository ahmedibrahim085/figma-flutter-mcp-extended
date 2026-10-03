#!/bin/bash
# Render check: generate Dart for one Figma node offline, analyse it, and render it in four hosts.
# Usage: npm run render-check -- [--theme | --typography] <fixture name in test/fixtures, or a path> <nodeId>
# --theme checks extract_theme_colors: its generated lib/theme (analysed with --fatal-infos) and the theme in four hosts.
# --typography checks extract_theme_typography: its generated lib/theme (analysed with --fatal-infos) and a Text in the first style, under its TextTheme, in four hosts.
# Needs Flutter on PATH. Exits non-zero on any analyzer error or Flutter layout error.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
npm run build --silent
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
