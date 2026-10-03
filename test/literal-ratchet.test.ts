import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// The hard-coded-value ratchet: tools/literal-scan.cjs --check compares every literal in src with
// tools/literal-baseline.tsv. The seam is the scanner process: argv in, exit code and stderr out.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCANNER = join(ROOT, 'tools', 'literal-scan.cjs');
const BASELINE = join(ROOT, 'tools', 'literal-baseline.tsv');
const HEADER = ['file', 'kind', 'text', 'context', 'function', 'count', 'class', 'reason'].join('\t');

// One-file repos keep each scan near 0.2 s; copying src/ would cost seconds.
function fixture(source: string, baselineRows: string[]): string {
    const repo = mkdtempSync(join(tmpdir(), 'literal-ratchet-'));
    mkdirSync(join(repo, 'src', 'tools'), {recursive: true});
    mkdirSync(join(repo, 'tools'));
    writeFileSync(join(repo, 'src', 'tools', 'x.ts'), source);
    writeFileSync(join(repo, 'tools', 'literal-baseline.tsv'), [HEADER, ...baselineRows].join('\n') + '\n');
    return repo;
}

function check(repo: string) {
    return spawnSync('node', [SCANNER, '--check', repo], {encoding: 'utf-8'});
}

function withFixture(source: string, baselineRows: string[], run: (repo: string) => void) {
    const repo = fixture(source, baselineRows);
    try {
        run(repo);
    } finally {
        rmSync(repo, {recursive: true, force: true});
    }
}

const CAP_KEY = ['src/tools/x.ts', 'number', '37', 'var(CAP)', 'CAP'].join('\t');
const CAP_ROW = [CAP_KEY, '1', 'K-CONV', 'a fixture constant'].join('\t');

test('a new literal fails the check, naming the file, the literal and where facts belong', () => {
    withFixture('export const CAP = 37;\n', [], (repo) => {
        const result = check(repo);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /src\/tools\/x\.ts:1/);
        assert.match(result.stderr, /number 37/);
        assert.match(result.stderr, /src\/defaults\.json/);
        // The message prints the exact baseline line to add.
        assert.ok(result.stderr.includes(CAP_KEY + '\t1\t'), result.stderr);
    });
});

test('a second copy of a baselined literal is new', () => {
    withFixture('export const CAP = 37;\nexport const CAP = 37;\n', [CAP_ROW], (repo) => {
        const result = check(repo);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /src\/tools\/x\.ts:2/);
    });
});

test('a baselined literal passes wherever it sits in the file', () => {
    withFixture('// moved down\n\n\nexport const CAP = 37;\n', [CAP_ROW], (repo) => {
        const result = check(repo);
        assert.equal(result.status, 0, result.stderr);
    });
});

test('a baselined literal that left src fails the check until its line is deleted', () => {
    withFixture('export const CAP = process.env.CAP;\n', [CAP_ROW], (repo) => {
        const result = check(repo);
        assert.equal(result.status, 1, result.stderr);
        assert.ok(result.stderr.includes(CAP_KEY), result.stderr);
        assert.match(result.stderr, /Delete/);
    });
});

test('a baseline row without a class fails the check, naming the file and the literal', () => {
    const row = [CAP_KEY, '1', '', 'a fixture constant'].join('\t');
    withFixture('export const CAP = 37;\n', [row], (repo) => {
        const result = check(repo);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /src\/tools\/x\.ts/);
        assert.match(result.stderr, /number\t37|37/);
        assert.match(result.stderr, /no class/);
    });
});

test('a baseline row without a reason fails the check, naming the file and the literal', () => {
    const row = [CAP_KEY, '1', 'K-CONV', ''].join('\t');
    withFixture('export const CAP = 37;\n', [row], (repo) => {
        const result = check(repo);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /src\/tools\/x\.ts/);
        assert.match(result.stderr, /no reason/);
    });
});

test('a control character in a literal is written escaped, so no baseline line holds a raw NUL', () => {
    withFixture("export const SEP = 'a\\0b';\n", [], (repo) => {
        const result = spawnSync('node', [SCANNER, repo], {encoding: 'utf-8'});
        assert.equal(result.status, 0, result.stderr);
        assert.ok(!result.stdout.includes('\0'), 'the inventory holds a raw NUL byte');
        assert.ok(result.stdout.includes('a\\x00b'), result.stdout);
    });
});

test('the real src tree matches the committed baseline', () => {
    const result = check(ROOT);
    assert.equal(result.status, 0, result.stderr);
});

test('every baseline line has an allowed class and a reason; a fact class names the ticket that removes it', () => {
    const allowed = ['K-TEXT', 'K-API', 'K-DART', 'K-CONV', 'K-SCHEMA', 'F-HEUR', 'F-DEFAULT', 'F-FACT', 'F-GUIDE', 'F-LEAK'];
    const raw = readFileSync(BASELINE, 'utf-8');
    assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(raw), 'the baseline holds a raw control character: a tool may read the line as ending there');
    const lines = raw.split('\n').filter((line) => line !== '');
    assert.equal(lines[0], HEADER);
    assert.ok(lines.length > 1, 'the baseline must list the literals that exist today');
    for (const line of lines.slice(1)) {
        const [, , , , , count, klass, reason] = line.split('\t');
        assert.match(count, /^[1-9]\d*$/, line);
        assert.ok(allowed.includes(klass), `unknown class ${klass}: ${line}`);
        assert.ok(reason && reason.trim() !== '', `no reason: ${line}`);
        if (klass.startsWith('F-')) assert.match(reason, /ticket \d+|B3\.\d+|decision \d+/, `fact row without an owner: ${line}`);
    }
});
