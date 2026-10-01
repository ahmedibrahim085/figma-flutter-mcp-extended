#!/bin/bash
# Render check: generate Dart for one Figma node offline, analyse it, and render it in four hosts.
# Usage: npm run render-check -- <fixture name in test/fixtures, or a path> <nodeId>
# Needs Flutter on PATH. Exits non-zero on any analyzer error or Flutter layout error.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
npm run build --silent
node --import tsx "$HERE/generate.mts" "$@"
cd "$HERE/flutter"
flutter pub get >/dev/null
dart analyze --fatal-warnings lib/generated.dart
flutter test test/host_matrix_test.dart
