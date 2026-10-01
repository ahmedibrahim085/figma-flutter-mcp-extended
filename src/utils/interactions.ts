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
