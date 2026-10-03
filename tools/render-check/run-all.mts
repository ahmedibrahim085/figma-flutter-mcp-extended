// Runs the render check on every node in expected.json and compares each result with the list, so a change that
// breaks a passing node, or fixes a known failure, shows up instead of vanishing among the known failures.
// Usage: node --import tsx tools/render-check/run-all.mts [--list <file>] [node id ...]   (npm run render-check:all)
// expected.json: one entry per reference image in test/fixtures/screenshots/manifest.json: node, fixture,
// expect "pass" | "fail", and for a "fail" the register id (BACKLOG B3.NN) of the defect behind it.
// Exits 1 on NEW FAILURE, NOW PASSES, NOT LISTED, or a run that produced no usable result (ERROR); 2 on a malformed list or
// a node id that is not in the list. A mismatch names a log file with the whole run.sh output.
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');
const only: string[] = [];
let listArg: string | undefined;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') listArg = args[++i];
    else only.push(args[i]);
}
const listPath = resolve(listArg ?? join(HERE, 'expected.json'));
type Entry = {node: string; fixture: string; expect: 'pass' | 'fail'; register?: string};
const list: Entry[] = JSON.parse(readFileSync(listPath, 'utf-8'));

const malformed = list.filter((e) => (e.expect !== 'pass' && e.expect !== 'fail') || (e.expect === 'fail') !== Boolean(e.register));
if (malformed.length > 0) {
    console.error(`${listPath}: expect must be "pass" or "fail", and only a "fail" carries a register id: ${malformed.map((e) => e.node).join(', ')}`);
    process.exit(2);
}
const unknown = only.filter((id) => !list.some((e) => e.node === id));
if (unknown.length > 0) {
    for (const id of unknown) console.error(`NOT IN LIST ${id}: ${listPath} has no entry for it`);
    process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/screenshots/manifest.json'), 'utf-8'));
const notListed = manifest.screenshots.map((s: any) => s.nodeId).filter((id: string) => !list.some((e) => e.node === id));

let mismatches = notListed.length;
for (const id of notListed) console.log(`NOT LISTED ${id}: add it to ${listPath} as pass, or as fail with its register id`);
for (const entry of list.filter((e) => only.length === 0 || only.includes(e.node))) {
    const run = spawnSync('bash', [join(HERE, 'run.sh'), entry.fixture, entry.node], {cwd: ROOT, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024});
    const output = `${run.stdout}${run.stderr}`;
    // A pass is Flutter's own "All tests passed!". A fail needs Flutter's "Some tests failed." AND a line from one of our
    // checks: a compile error in the harness or in the generated Dart also ends in "Some tests failed." (planted
    // syntax error, 2026-10-03), and must not pass for a known failure.
    const checkLine = /Figma -?[\d.]+, Flutter -?[\d.]+|differ from Figma by more than|image size: Figma|Flutter error:|no widget with this key was built/;
    const result = run.status === 0 && /All tests passed!/.test(output) ? 'pass'
        : /Some tests failed\./.test(output) && checkLine.test(output) ? 'fail' : undefined;
    const log = join(tmpdir(), `render-check-${entry.node.replace(/:/g, '_')}.log`);
    const logged = () => { writeFileSync(log, output); return ` (whole run.sh output: ${log})`; };
    if (result === undefined) {
        mismatches++;
        console.log(`ERROR ${entry.node}: no usable test result (exit ${run.status}); last line: ${output.trim().split('\n').pop()}${logged()}`);
    } else if (result === entry.expect) {
        console.log(`ok ${entry.node} ${result}${entry.register ? ` (${entry.register})` : ''}`);
    } else if (result === 'fail') {
        mismatches++;
        console.log(`NEW FAILURE ${entry.node}: expected pass${logged()}`);
    } else {
        mismatches++;
        console.log(`NOW PASSES ${entry.node} (${entry.register}): remove it from the list${logged()}`);
    }
}
console.log(mismatches === 0 ? 'render check: every node as listed' : `render check: ${mismatches} node(s) differ from the list`);
process.exit(mismatches === 0 ? 0 : 1);
