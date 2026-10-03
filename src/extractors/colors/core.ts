// src/extractors/colors/core.mts

import type {FigmaNode} from '../../types/figma.js';
import type {ThemeColor} from './types.js';
import {
    extractColorsFromThemeFrame,
} from './extractor.js';

/**
 * Main color extraction orchestrator
 */
export class ColorExtractor {
    /**
     * Extract theme colors from a specific frame
     */
    extractThemeFromFrame(frameNode: FigmaNode, styleNames?: Record<string, {name: string}>): ThemeColor[] {
        return extractColorsFromThemeFrame(frameNode, styleNames);
    }

}

/**
 * Convenience function to extract theme colors from a frame
 */
export function extractThemeColors(frameNode: FigmaNode, styleNames?: Record<string, {name: string}>): ThemeColor[] {
    const extractor = new ColorExtractor();
    return extractor.extractThemeFromFrame(frameNode, styleNames);
}
