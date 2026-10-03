// src/extractors/components/types.mts

import type {FigmaNode, FigmaColor, FigmaEffect, FigmaInteraction} from '../../types/figma.js';
import type {TextStyleFields, TextWidgetFields} from '../flutter/text-style.js';

/**
 * Main component analysis result
 */
export interface ComponentAnalysis {
    metadata: ComponentMetadata;
    layout: LayoutInfo;
    styling: StylingInfo;
    children: ComponentChild[];
    nestedComponents: NestedComponentInfo[];
    variants?: ComponentVariant[];
    skippedNodes?: SkippedNodeInfo[];
}

/**
 * Component metadata information
 */
export interface ComponentMetadata {
    name: string;
    type: 'COMPONENT' | 'COMPONENT_SET' | 'FRAME';
    nodeId: string;
    description?: string;
    variantCount?: number;
    isUserDefinedComponent?: boolean; // When user treats FRAME as component
    componentKey?: string; // For actual Figma components
    /** INSTANCE componentProperties (BOOLEAN / TEXT / INSTANCE_SWAP / VARIANT). */
    componentProperties?: ComponentPropertyInfo[];
    /** Prototype interactions, passed through for the agent. */
    interactions?: FigmaInteraction[];
}

/**
 * Figma INSTANCE component property (including BOOLEAN show/hide toggles).
 */
export interface ComponentPropertyInfo {
    name: string;
    rawKey: string;
    type: string;
    value: string | boolean | number;
}

/**
 * Layout structure information
 */
export interface LayoutInfo {
    type: 'auto-layout' | 'absolute' | 'frame';
    direction?: 'horizontal' | 'vertical';
    spacing?: number;
    padding?: PaddingInfo;
    constraints?: any;
    dimensions: {
        width: number;
        height: number;
    };
    alignItems?: string;
    justifyContent?: string;
    mainAxisAlignment?: string;
    crossAxisAlignment?: string;
    sizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
    sizingVertical?: 'FIXED' | 'HUG' | 'FILL';
    layoutAlign?: 'INHERIT' | 'STRETCH';
    layoutGrow?: number;
    /** Top-left of the node's absoluteBoundingBox; a child's position is its origin minus its parent's. */
    origin?: {x: number; y: number};
    positioning?: 'AUTO' | 'ABSOLUTE';
    clipsContent?: boolean;
    /** The node's layoutMode as Figma names it (NONE, HORIZONTAL, VERTICAL, GRID). */
    layoutMode?: string;
    /** GRID auto layout counts and gaps, when Figma sends them. */
    grid?: {rows?: number; columns?: number; rowGap?: number; columnGap?: number};
    /** True when Figma sent no absoluteBoundingBox: `dimensions` and `origin` are then placeholders. */
    boundsMissing?: boolean;
    /** One radius, or [topLeft, topRight, bottomRight, bottomLeft] from rectangleCornerRadii. */
    cornerRadius?: number | number[];
    rotation?: number;
    reverseZIndex?: boolean;
    /** Figma min/max sizes; REST sends null or omits the key when unset. */
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
}

/**
 * Padding information
 */
export interface PaddingInfo {
    top: number;
    right: number;
    bottom: number;
    left: number;
    isUniform: boolean;
}

/**
 * Visual styling information
 */
export interface StylingInfo {
    fills?: ColorInfo[];
    strokes?: StrokeInfo[];
    effects?: CategorizedEffects;
    cornerRadius?: number | CornerRadii;
    opacity?: number;
}

/**
 * Color information extracted from fills
 */
export interface ColorInfo {
    type: string;
    blendMode?: string;
    color?: FigmaColor;
    hex?: string;
    opacity?: number;
    gradientStops?: Array<{
        color: FigmaColor;
        position: number;
    }>;
}

/**
 * Stroke information
 */
export interface StrokeInfo {
    type: string;
    color: FigmaColor;
    hex: string;
    /** The paint's own opacity, when Figma sent one. */
    opacity?: number;
    /** Undefined when Figma sent no strokeWeight. */
    weight?: number;
    /** Per-side weights, when Figma sent individualStrokeWeights. */
    individualWeights?: {top: number; right: number; bottom: number; left: number};
    align?: string;
}

/**
 * Corner radius information
 */
export interface CornerRadii {
    topLeft: number;
    topRight: number;
    bottomLeft: number;
    bottomRight: number;
    isUniform: boolean;
}

/**
 * Categorized effects for Flutter mapping
 */
export interface CategorizedEffects {
    dropShadows: DropShadowEffect[];
    innerShadows: InnerShadowEffect[];
    blurs: BlurEffect[];
}

/**
 * Drop shadow effect
 */
export interface DropShadowEffect {
    color: FigmaColor;
    hex: string;
    /** Undefined when Figma sent no offset. */
    offset?: {x: number; y: number};
    radius: number;
    spread?: number;
    opacity: number;
}

/**
 * Inner shadow effect
 */
export interface InnerShadowEffect {
    color: FigmaColor;
    hex: string;
    /** Undefined when Figma sent no offset. */
    offset?: {x: number; y: number};
    radius: number;
    spread?: number;
    opacity: number;
}

/**
 * Blur effect
 */
export interface BlurEffect {
    type: string;
    radius: number;
}

/**
 * Child component information
 */
export interface ComponentChild {
    nodeId: string;
    name: string;
    type: string;
    isNestedComponent: boolean;
    basicInfo?: {
        layout?: Partial<LayoutInfo>;
        styling?: Partial<StylingInfo>;
        text?: TextInfo;
    };
    children?: ComponentChild[];
    /** Prototype interactions, passed through for the agent. */
    interactions?: FigmaInteraction[];
}

/**
 * Enhanced text-specific information
 */
export interface TextInfo {
    content: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    textAlign?: string;
    /** TextStyle inputs, shared by every code path that writes this text. */
    style?: TextStyleFields;
    /** Text-widget fields (letter case applied, alignment, truncation), shared by every code path. */
    widget?: TextWidgetFields;
    textCase?: 'uppercase' | 'lowercase' | 'capitalize' | 'sentence' | 'mixed';
}

/**
 * Nested component that should be analyzed separately
 */
export interface NestedComponentInfo {
    nodeId: string;
    name: string;
    componentKey?: string;
    masterComponent?: string;
    isComponentInstance: boolean;
    needsSeparateAnalysis: boolean;
    /** Figma's node.type of the nested component. */
    instanceType?: 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE';
}

/**
 * Component variant information
 */
/** A VARIANT property of a component set, as Figma defines it. */
export interface VariantAxis {
    name: string;
    options: string[];
    defaultValue: string;
}

export interface ComponentVariant {
    nodeId: string;
    name: string;
    properties: Record<string, string>;
    isDefault: boolean;
}

/**
 * Information about nodes that were skipped due to limits
 */
export interface SkippedNodeInfo {
    nodeId: string;
    name: string;
    type: string;
    reason: 'depth_limit' | 'max_nodes';
}

/**
 * Component extraction options
 */
export interface ComponentExtractionOptions {
    maxChildNodes?: number;
    maxDepth?: number;
    includeHiddenNodes?: boolean;
    extractTextContent?: boolean;
}