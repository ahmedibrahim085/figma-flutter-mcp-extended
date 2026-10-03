// src/extractors/colors/types.mts

import type {FigmaNode} from '../../types/figma.js';
import type {ColorInfo} from '../components/types.js';

/**
 * Color definition from theme extraction
 */
export interface ThemeColor {
    /** Fill style name, else bound variable name (or id), else layer name. */
    name: string;
    fill: ColorInfo;
    nodeId: string;
    /** Set while the swatch is named by a bound variable the variables endpoint has not named yet. */
    variableId?: string;
}

/**
 * Deduplicated color definition for design system
 */
export interface ColorDefinition {
    id: string;
    name: string;
    value: string; // hex color
    usage: 'primary' | 'secondary' | 'background' | 'text' | 'accent' | 'other';
    usageCount: number;
}

/**
 * Color extraction context
 */
export interface ColorExtractionContext {
    colorMap: Map<string, string>; // color value -> color ID
    currentDepth: number;
    maxDepth: number;
}

/**
 * Color extractor function type
 */
export type ColorExtractorFn = (
    node: FigmaNode,
    context: ColorExtractionContext,
    colorLibrary: ColorDefinition[]
) => string[] | null; // Returns color IDs

/**
 * Flutter theme generation options
 */
export interface ThemeGenerationOptions {
    generateThemeData?: boolean;
    includeColorScheme?: boolean;
    includeMaterialColors?: boolean;
}
