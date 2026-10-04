import defaults from '../defaults.json' with { type: 'json' };

/** A node tree cut in document order: the first `limit` nodes stay, and the root of each cut subtree is listed in `omitted`. */
export interface Cut {
    limit: number;
    included: number;
    omitted: string[];
}

/** What a tool declares to the client so it raises its output limit to the budget (Claude Code reads this key). */
export const BUDGET_META = {'anthropic/maxResultSizeChars': defaults.maxResultSizeChars};

export const newCut = (limit: number): Cut => ({limit, included: 0, omitted: []});

/** How many nodes `nodes` and their descendants hold. */
export const countNodes = <T extends {children?: T[]}>(nodes: T[]): number =>
    nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);

/**
 * `render(n)` serialises the first n of `total` items in document order. Returns the text for all of them when it fits
 * the response budget (defaults.maxResultSizeChars), else for the most that fit; `least` is the fewest it may keep: the
 * `ff_*` tools always keep the root (1), the analysis tools may keep none because their report has fixed sections (0).
 *
 * The search starts at the fewest items and grows toward the budget by the length it just saw (at least 2x, at most
 * 16x per step), so no render is much larger than the budget: a whole 30,000-node tree is 17.9 M characters, and
 * rendering it first and halving down cost 80 ms of every reply that was cut.
 */
export function renderWithinBudget(total: number, render: (n: number) => string, least = 1): string {
    const budget = defaults.maxResultSizeChars;
    let [fits, over] = [least, total + 1];
    let fitText: string | undefined;
    for (let n = Math.min(total, least + 1); ; ) {
        const text = render(n);
        if (text.length > budget) {
            over = n;
            break;
        }
        [fits, fitText] = [n, text];
        if (n === total) return text;
        n = Math.min(total, Math.min(n * 16, Math.max(n * 2, Math.floor((n * budget) / text.length))));
    }
    while (over - fits > 1) {
        const mid = Math.floor((fits + over) / 2);
        const text = render(mid);
        if (text.length <= budget) [fits, fitText] = [mid, text];
        else over = mid;
    }
    return fitText ?? render(fits);
}

/**
 * The tree with nodes beyond the cut marked `omitted` and stripped of their children, so a renderer can put a placeholder where each
 * one was. Document order is pre-order; an omitted node's descendants are not listed, only its own id.
 */
export function cutTree<T extends {nodeId: string; children?: T[]; omitted?: boolean}>(nodes: T[], cut: Cut): T[] {
    return nodes.map((node) => {
        if (cut.included >= cut.limit) {
            cut.omitted.push(node.nodeId);
            return {...node, omitted: true, children: undefined};
        }
        cut.included++;
        return node.children ? {...node, children: cutTree(node.children, cut)} : node;
    });
}

/** The first of `ids` that fit defaults.omittedIdListChars (as listed, with a ", " between), so the id list cannot overrun the budget. */
export function capIds(ids: string[]): string[] {
    let used = 0;
    const end = ids.findIndex((id) => (used += id.length + 2) - 2 > defaults.omittedIdListChars);
    return end < 0 ? ids : ids.slice(0, end);
}

/** The lines that say a report was cut, in the words of the `ff_*` JSON tools; '' when nothing was. The count is added only when the id list was capped. */
export function budgetNote(omitted: string[]): string {
    if (omitted.length === 0) return '';
    const listed = capIds(omitted);
    const count = listed.length < omitted.length ? `omittedNodeCount: ${omitted.length}\n` : '';
    return `\ntruncated: true\nomittedNodeIds: ${listed.join(', ')}\n${count}`;
}
