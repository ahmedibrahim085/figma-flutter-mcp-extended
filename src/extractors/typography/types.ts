// src/extractors/typography/types.mts

import type {FigmaNode} from '../../types/figma.js';
import type {TextStyleFields} from '../flutter/text-style.js';

/**
 * Typography style definition from theme extraction
 */
export interface TypographyStyle {
    /** The text style's name when the node uses one, else the layer name. */
    name: string;
    nodeId: string;
    fields: TextStyleFields;
    /** Figma text properties a Flutter TextStyle cannot hold, each with its value. */
    unsupported: string[];
}

/**
 * Deduplicated typography definition for design system
 */
export interface TypographyDefinition {
    id: string;
    name: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    letterSpacing: number;
    usage: 'heading' | 'body' | 'caption' | 'button' | 'label' | 'other';
    usageCount: number;
    // Additional Flutter-specific properties
    dartName?: string; // Dart-safe property name
}

/**
 * Typography extraction context
 */
export interface TypographyExtractionContext {
    typographyMap: Map<string, string>; // style hash -> typography ID
    currentDepth: number;
    maxDepth: number;
}

/**
 * Typography extractor function type
 */
export type TypographyExtractorFn = (
    node: FigmaNode,
    context: TypographyExtractionContext,
    typographyLibrary: TypographyDefinition[]
) => string[] | null; // Returns typography IDs

/**
 * Typography extraction options
 */
export interface TypographyExtractionOptions {
    maxDepth?: number;
    includeHiddenText?: boolean;
    minUsageCount?: number;
    excludeEmptyText?: boolean;
}

/**
 * Font weight mapping for Flutter
 */
export interface FontWeightMapping {
    [key: number]: string; // Figma weight -> Flutter FontWeight
}

/**
 * Text style hash components for deduplication
 */
export interface TextStyleHash {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    letterSpacing: number;
}
