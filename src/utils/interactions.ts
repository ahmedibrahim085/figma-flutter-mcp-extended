import type {FigmaAction, FigmaInteraction} from '../types/figma.js';

/** One action as the Figma REST API names it: "NODE NAVIGATE 5:5", "URL https://…", "BACK". */
function formatAction(action: FigmaAction): string {
    if (action.type === 'URL') return `URL ${action.url}`;
    if (action.type === 'NODE') return `NODE ${action.navigation} ${action.destinationId}`;
    return action.type;
}

/**
 * Report a node's prototype interactions as Figma states them, for the agent to read intent from
 * (a tap target, a link). Nothing is inferred from them; the widget code stays what the design draws.
 */
export function formatInteractions(interactions: FigmaInteraction[] | undefined, indent: string): string {
    if (!interactions || interactions.length === 0) return '';
    // Figma sends a null trigger for an interaction whose trigger was removed.
    const parts = interactions.map(interaction =>
        `${interaction.trigger?.type ?? 'no trigger'} → ${(interaction.actions ?? []).map(formatAction).join(', ') || 'no action'}`);
    return `${indent}Interactions: ${parts.join('; ')}\n`;
}

interface InteractionNode {
    nodeId: string;
    name: string;
    interactions?: FigmaInteraction[];
    children?: InteractionNode[];
}

/**
 * Report the interactions of every descendant, each under its layer name and node id so the agent
 * can find it. A direct child prints its own interactions in the child list; this covers below it.
 */
export function formatNestedInteractions(children: InteractionNode[] | undefined, indent: string): string {
    return (children ?? []).map(child =>
        (child.interactions?.length ? `${indent}${child.name.replace(/[\r\n]+/g, ' ')} (${child.nodeId})\n${formatInteractions(child.interactions, indent + '  ')}` : '')
        + formatNestedInteractions(child.children, indent)).join('');
}
