// src/extractors/screens/core.mts

import type {FigmaNode} from '../../types/figma.js';
import type {
    ScreenAnalysis,
    ScreenExtractionOptions
} from './types.js';
import {
    extractScreenMetadata,
    extractScreenLayoutInfo,
    analyzeScreenChildren,
} from './extractor.js';

/**
 * Screen extraction and analysis class
 */
export class ScreenExtractor {
    private options: Required<ScreenExtractionOptions>;

    constructor(options: ScreenExtractionOptions = {}) {
        this.options = {
            includeHiddenNodes: options.includeHiddenNodes ?? false,
        };
    }

    /**
     * Main screen analysis method
     */
    async analyzeScreen(node: FigmaNode): Promise<ScreenAnalysis> {
        const metadata = extractScreenMetadata(node);
        const layout = extractScreenLayoutInfo(node);
        
        const {children, components} = analyzeScreenChildren(node, this.options);

        return {
            metadata,
            layout,
            children,
            components
        };
    }

    /**
     * Get extractor options
     */
    getOptions(): Required<ScreenExtractionOptions> {
        return this.options;
    }
}

/**
 * Convenience function to analyze a screen
 */
export async function analyzeScreen(
    node: FigmaNode,
    options: ScreenExtractionOptions = {}
): Promise<ScreenAnalysis> {
    const extractor = new ScreenExtractor(options);
    return extractor.analyzeScreen(node);
}
