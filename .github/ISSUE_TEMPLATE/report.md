---
name: Report a problem
about: The figma-flutter server gave a wrong, missing or broken result
title: "[problem] <tool name>: <one-line symptom>"
labels: ""
---

<!--
Do not paste secrets. No Figma API keys, no tokens, no private file keys, no project or client details.
Redact Figma file keys and node ids in arguments, for example `fileKey: <redacted>`, `nodeId: <redacted>`.
-->

## Symptom

One or two sentences: what went wrong.

## Tool and arguments

- Tool called (for example `ff_get_screenshot`, `generate_flutter_implementation`):
- Arguments, with Figma file and node ids redacted:

## What the output showed

The Flutter code or report text that was wrong, missing or broken. Quote the exact lines.

## What Figma shows

What the node looks like in Figma, and what you expected the output to be.

## When and how often

- First seen (UTC date and time):
- Every call, sometimes, or once:

## Evidence

Error text, the tool's report, or a log excerpt. Redact keys and ids.

## Server version and environment

- Server version (`serverInfo.version` in the initialize result):
- Transport: stdio / HTTP
- Client (for example Claude Code, Cursor):
- OS:
- Node version:

## Workaround

What you tried, and whether it worked.

## Impact

What this blocks, and how many designs or screens it affects.
