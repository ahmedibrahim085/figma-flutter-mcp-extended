// The budget cut finds the most items that fit without rendering the whole tree first.
// The first three tests import renderWithinBudget directly: they need render functions with chosen sizes, which no tool call
// can supply through the stdio seam, and they count the renders. The five reply pins below stay at the stdio seam.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {renderWithinBudget} from '../src/utils/budget.ts';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

const BUDGET = 100000;

/** The search as it was before the single-pass change: render everything, then halve. The oracle for "same result". */
function halving(total: number, render: (n: number) => string, least: number): string {
    const whole = render(total);
    if (whole.length <= BUDGET) return whole;
    let [fits, over] = [least, total];
    while (over - fits > 1) {
        const mid = Math.floor((fits + over) / 2);
        if (render(mid).length <= BUDGET) fits = mid;
        else over = mid;
    }
    return render(fits);
}

/** A render whose length grows with n: `fixed` characters plus each item's own length, so the length of n items is the running sum. */
function sized(fixed: number, items: number[]) {
    const calls: number[] = [];
    const render = (n: number) => {
        calls.push(n);
        const length = fixed + items.slice(0, n).reduce((sum, item) => sum + item, 0);
        return `${n}:`.padEnd(length, '.');
    };
    return {render, calls};
}

let seed = 12345;
const random = (below: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % below;

test('the cut keeps exactly the items the halving search kept, for 400 random item sizes', () => {
    for (let round = 0; round < 400; round++) {
        const total = 1 + random(3000);
        const items = Array.from({length: total}, () => 1 + random(1 + random(900)));
        const fixed = random(2000);
        const least = random(2);
        assert.equal(renderWithinBudget(total, sized(fixed, items).render, least), halving(total, sized(fixed, items).render, least),
            `round ${round}: ${total} items, fixed ${fixed}, least ${least}`);
    }
});

test('a tree that fits is returned whole, and one that cannot keep even `least` items keeps `least`', () => {
    assert.equal(renderWithinBudget(50, sized(100, Array(50).fill(10)).render), sized(100, Array(50).fill(10)).render(50));
    assert.equal(renderWithinBudget(5, sized(BUDGET + 1, Array(5).fill(10)).render, 0), sized(BUDGET + 1, Array(5).fill(10)).render(0));
    assert.equal(renderWithinBudget(5, sized(BUDGET + 1, Array(5).fill(10)).render), sized(BUDGET + 1, Array(5).fill(10)).render(1));
});

test('a 30,000-item tree that is cut is never rendered whole, and the renders add up to a few budgets', () => {
    const {render, calls} = sized(200, Array(30000).fill(600));
    renderWithinBudget(30000, render);

    assert.ok(!calls.includes(30000), `rendered all 30000 items: ${calls.join(', ')}`);
    const rendered = calls.reduce((sum, n) => sum + 200 + n * 600, 0);
    assert.ok(rendered <= 20 * BUDGET, `${rendered} characters rendered in ${calls.length} renders`);
});

// ── reply identity at the stdio seam ────────────────────────────────────────

const RED = {type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}};
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
const style = {fontFamily: 'Inter', fontSize: 12, fontWeight: 400, letterSpacing: 0, lineHeightPx: 14, lineHeightUnit: 'PIXELS'};
const leaf = (i: number) => i % 3 === 0
    ? {id: `9:${i}`, name: `T${i}`, type: 'TEXT', characters: `copy ${i}`, fills: [RED], absoluteBoundingBox: box(60, 12), style}
    : {id: `9:${i}`, name: `R${i}`, type: 'RECTANGLE', fills: [RED], absoluteBoundingBox: box(40, 40)};
const wide = (count: number) => ({id: '1:1', name: 'Wide', type: 'FRAME', layoutMode: 'VERTICAL', fills: [], absoluteBoundingBox: box(375, 5000),
    children: Array.from({length: count}, (_, i) => leaf(i + 1))});
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// Pinned from the halving search (commit 8222242): the cut reply of each tool is byte for byte what it was. The two JSON tools
// were re-pinned for compact JSON (B3.81): more children fit, so their cut moved; the other three tools are unchanged.
// The two re-pinned length/hash values are snapshots of the new output, not independent proof. The independent checks are in
// core-tools.test.ts: more than 400 of 1500 children kept, text.length <= budget, kept + omitted ids = input ids.
const PINNED: Array<[tool: string, query: string, args: Record<string, unknown>, children: number, length: number, sha: string]> = [
    ['ff_get_metadata', 'ids=1:1', {fileKey: FILE_KEY}, 1500, 99991, 'fecb47ccaa44a683'],
    ['ff_get_design_context', 'ids=1:1', {fileKey: FILE_KEY}, 1500, 99988, '5b86bcfa7635615f'],
    ['generate_flutter_implementation', '', {input: FILE_KEY}, 700, 99967, 'b31486a984dcde3c'],
    ['analyze_frame_as_screen', '', {input: FILE_KEY, extractAssets: false}, 1500, 99937, 'a5dc7e39988dec7a'],
    ['inspect_frame_structure', '', {input: FILE_KEY}, 1500, 99931, '70e55117d0f859d6'],
];
for (const [tool, query, args, children, length, hash] of PINNED) {
    test(`${tool}: the reply for a ${children}-child frame over the budget is byte for byte the one the halving search gave`, async () => {
        const doc = wide(children);
        const routes = query ? {[`/files/${FILE_KEY}/nodes?${query}`]: {body: {nodes: {'1:1': {document: doc}}}}} : nodeRoute('1:1', doc);
        const {text} = await callToolOffline(routes, tool, {nodeId: '1:1', ...args});

        assert.deepEqual([text.length, sha(text)], [length, hash]);
    });
}
