#!/bin/bash
# Mutation runner: apply each mutant to the source, rebuild, run the tests, and report whether a
# test failed (the mutant is "killed"). Run it in a git worktree of the repo (git worktree add),
# never in a checkout someone else is using: each mutant edits files in place. A plain copy without
# .git will not do, because each mutant is reverted with git checkout.
# Usage: tools/mutants.sh <mutant list file> [test file ...]   (default: test/*.test.ts)
# The list path is relative to where you run it; test files are relative to the repo root.
# A signal sent to this script alone takes effect when the running build or test step ends
# (Ctrl-C reaches the whole process group and stops at once); the mutated file is put back either way.
# List lines: name<TAB>repo-relative file<TAB>perl -0pi expression
# Each mutant is reverted with git checkout, so it must target a tracked file, and the copy
# must hold no uncommitted changes.
set -u
if [ $# -lt 1 ] || [ ! -f "$1" ]; then
  echo "usage: tools/mutants.sh <mutant list file> [test file ...]; list file not found: ${1:-<none>}" >&2
  exit 2
fi
LIST="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
cd "$(dirname "$0")/.." || exit 2
if [ $# -eq 0 ]; then set -- test/*.test.ts; fi
# The git root must be this copy itself: a plain copy nested inside another repo would pass a looser check.
if [ "$(git rev-parse --show-toplevel 2>/dev/null)" != "$(pwd -P)" ]; then
  echo "refusing to run: $(pwd -P) is not the root of a git work tree, so mutants could not be reverted; use git worktree add" >&2
  exit 2
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "refusing to run: uncommitted changes would be lost by git checkout; commit them first" >&2
  exit 2
fi
LOG="$(mktemp)"
CURRENT=""
# On exit, Ctrl-C, SIGTERM or SIGHUP, put back the file being mutated and remove the log. A run killed
# outright (SIGKILL, or SIGPIPE when stdout is piped into a reader that stops early) leaves the mutant
# in place; the uncommitted-changes check above then refuses the next run until it is restored.
cleanup() {
  [ -n "$CURRENT" ] && git checkout -- "$CURRENT"
  rm -f "$LOG"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
while IFS=$'\t' read -r name file expr; do
  [ -z "$name" ] && continue
  if ! git ls-files --error-unmatch -- "$file" >/dev/null 2>&1; then
    echo "== $name: SKIPPED, $file is not tracked by git, so the mutant could not be reverted"
    continue
  fi
  CURRENT="$file"
  perl -0pi -e "$expr" "$file"
  if git diff --quiet -- "$file"; then echo "== $name: DID NOT APPLY"; CURRENT=""; continue; fi
  if ! npm run build >/dev/null 2>&1; then
    echo "== $name: build failed"
  else
    node --import tsx --test --test-concurrency=1 "$@" > "$LOG" 2>&1; ex=$?
    echo "== $name exit=$ex $(grep -E '^# fail' "$LOG")"; grep -E '^not ok' "$LOG" | cut -c1-110
  fi
  git checkout -- "$file"
  CURRENT=""
done < "$LIST"
if ! npm run build >/dev/null 2>&1; then
  echo "final rebuild of the unmutated source failed" >&2
  exit 1
fi
