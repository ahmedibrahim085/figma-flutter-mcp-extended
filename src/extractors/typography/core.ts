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
    extractThemeFromFrame(frameNode: FigmaNode, styles?: Record<string, {name: string; styleType: string}>): TypographyStyle[] {
        return extractTypographyFromThemeFrame(frameNode, styles);
    }

}

/**
 * Convenience function to extract theme typography from a frame
 */
export function extractThemeTypography(frameNode: FigmaNode, styles?: Record<string, {name: string; styleType: string}>): TypographyStyle[] {
    const extractor = new TypographyExtractor();
    return extractor.extractThemeFromFrame(frameNode, styles);
}