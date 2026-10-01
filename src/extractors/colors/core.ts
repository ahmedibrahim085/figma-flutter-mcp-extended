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
    extractThemeFromFrame(frameNode: FigmaNode): ThemeColor[] {
        return extractColorsFromThemeFrame(frameNode);
    }

}

/**
 * Convenience function to extract theme colors from a frame
 */
export function extractThemeColors(frameNode: FigmaNode): ThemeColor[] {
    const extractor = new ColorExtractor();
    return extractor.extractThemeFromFrame(frameNode);
}
