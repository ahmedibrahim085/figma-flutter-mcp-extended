import type { FigmaEffect } from '../types/figma.js';
import { categorizeEffects } from '../extractors/components/extractor.js';
import type { CategorizedEffects } from '../extractors/components/types.js';

/**
 * Format categorized effects for MCP text reports.
 * Source is node.effects (Figma API), not the Design panel label.
 */
export function formatCategorizedEffects(
    effects: CategorizedEffects | undefined,
    indent: string = ''
): string {
    if (!effects) {
        return '';
    }

    const formatShadow = (label: string, shadow: CategorizedEffects['dropShadows'][number], index: number): string => {
        let line = `${indent}- ${label} ${index + 1}: ${shadow.hex} ` +
            `opacity ${Math.round(shadow.opacity * 100)}% ` +
            (shadow.offset ? `offset(${shadow.offset.x}, ${shadow.offset.y}) ` : `offset not set by Figma `) +
            `blur ${shadow.radius}px`;
        if (shadow.spread) {
            line += ` spread ${shadow.spread}px`;
        }
        return line + `\n`;
    };

    let output = '';

    effects.dropShadows.forEach((shadow, index) => {
        output += formatShadow('Drop shadow', shadow, index);
    });

    effects.innerShadows.forEach((shadow, index) => {
        output += formatShadow('Inner shadow', shadow, index);
    });

    effects.blurs.forEach((blur, index) => {
        output += `${indent}- Blur ${index + 1}: ${blur.type} radius ${blur.radius}px\n`;
    });

    return output;
}

/**
 * Format raw Figma effects array for structure-overview style reports.
 */
export function formatFigmaEffects(
    effects: FigmaEffect[] | undefined,
    indent: string = ''
): string {
    if (!effects || effects.length === 0) {
        return '';
    }

    return formatCategorizedEffects(categorizeEffects(effects), indent);
}
