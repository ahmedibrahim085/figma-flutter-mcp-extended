#!/bin/bash
# Mutation runner: apply each mutant to the source, rebuild, run the tests, and report whether a
# test failed (the mutant is "killed"). Run it in a COPY of the repo (git worktree add, or
# git archive | tar -x), never in a checkout someone else is using: each mutant edits files in place.
# Usage: tools/mutants.sh <mutant list file> [test files, default test/*.test.ts]
# List lines: name<TAB>repo-relative file<TAB>perl -0pi expression
# Each mutant is reverted with git checkout, so the copy must hold no uncommitted changes.
set -u
cd "$(dirname "$0")/.." || exit 1
LIST="$1"
TESTS="${2:-test/*.test.ts}"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "refusing to run: uncommitted changes would be lost by git checkout; commit them first" >&2
  exit 2
fi
LOG="$(mktemp)"
while IFS=$'\t' read -r name file expr; do
  [ -z "$name" ] && continue
  perl -0pi -e "$expr" "$file"
  if git diff --quiet -- "$file"; then echo "== $name: DID NOT APPLY"; continue; fi
  if ! npm run build >/dev/null 2>&1; then echo "== $name: build failed"; git checkout -- "$file"; continue; fi
  node --import tsx --test --test-concurrency=1 $TESTS > "$LOG" 2>&1; ex=$?
  echo "== $name exit=$ex $(grep -E '^# fail' "$LOG")"; grep -E '^not ok' "$LOG" | cut -c1-110
  git checkout -- "$file"
done < "$LIST"
npm run build >/dev/null 2>&1
rm -f "$LOG"
