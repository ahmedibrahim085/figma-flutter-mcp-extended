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
 */
export function renderWithinBudget(total: number, render: (n: number) => string, least = 1): string {
    const whole = render(total);
    if (whole.length <= defaults.maxResultSizeChars) return whole;
    let [fits, over] = [least, total];
    while (over - fits > 1) {
        const mid = Math.floor((fits + over) / 2);
        if (render(mid).length <= defaults.maxResultSizeChars) fits = mid;
        else over = mid;
    }
    return render(fits);
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

/** The two lines that say a report was cut, in the words of the `ff_*` JSON tools; '' when nothing was. */
export const budgetNote = (omitted: string[]): string =>
    omitted.length === 0 ? '' : `\ntruncated: true\nomittedNodeIds: ${omitted.join(', ')}\n`;
