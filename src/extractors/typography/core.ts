// src/extractors/typography/core.mts

import type {FigmaNode} from '../../types/figma.js';
import type {TypographyStyle} from './types.js';
import {
    extractTypographyFromThemeFrame,
} from './extractor.js';

/**
 * Main typography extraction orchestrator
 */
export class TypographyExtractor {
    /**
     * Extract theme typography from a specific frame
     */
    extractThemeFromFrame(frameNode: FigmaNode): TypographyStyle[] {
        return extractTypographyFromThemeFrame(frameNode);
    }

}

/**
 * Convenience function to extract theme typography from a frame
 */
export function extractThemeTypography(frameNode: FigmaNode): TypographyStyle[] {
    const extractor = new TypographyExtractor();
    return extractor.extractThemeFromFrame(frameNode);
}