// Runs the render check on every node in expected.json and compares each result with the list, so a change that
// breaks a passing node, or fixes a known failure, shows up instead of vanishing among the known failures.
// Usage: node --import tsx tools/render-check/run-all.mts [--list <file>] [node id ...]   (npm run render-check:all)
// expected.json: one entry per reference image in test/fixtures/screenshots/manifest.json: node, fixture,
// expect "pass" | "fail", and for a "fail" the register id (BACKLOG B3.NN) of the defect behind it.
// Exits 1 on NEW FAILURE, NOW PASSES, NOT LISTED, or a run that produced no test result (ERROR); 2 on a malformed list.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
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
const manifest = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/screenshots/manifest.json'), 'utf-8'));
const notListed = manifest.screenshots.map((s: any) => s.nodeId).filter((id: string) => !list.some((e) => e.node === id));

let mismatches = notListed.length;
for (const id of notListed) console.log(`NOT LISTED ${id}: add it to ${listPath} as pass, or as fail with its register id`);
for (const entry of list.filter((e) => only.length === 0 || only.includes(e.node))) {
    const run = spawnSync('bash', [join(HERE, 'run.sh'), entry.fixture, entry.node], {cwd: ROOT, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024});
    const output = `${run.stdout}${run.stderr}`;
    // Only a Flutter test result counts: a crash or a missing SDK also exits non-zero and must not pass for a known failure.
    const result = run.status === 0 && /All tests passed!/.test(output) ? 'pass' : /Some tests failed\./.test(output) ? 'fail' : undefined;
    if (result === undefined) {
        mismatches++;
        console.log(`ERROR ${entry.node}: no test result (exit ${run.status}); last line: ${output.trim().split('\n').pop()}`);
    } else if (result === entry.expect) {
        console.log(`ok ${entry.node} ${result}${entry.register ? ` (${entry.register})` : ''}`);
    } else if (result === 'fail') {
        mismatches++;
        console.log(`NEW FAILURE ${entry.node}: expected pass`);
    } else {
        mismatches++;
        console.log(`NOW PASSES ${entry.node} (${entry.register}): remove it from the list`);
    }
}
console.log(mismatches === 0 ? 'render check: every node as listed' : `render check: ${mismatches} node(s) differ from the list`);
process.exit(mismatches === 0 ? 0 : 1);
