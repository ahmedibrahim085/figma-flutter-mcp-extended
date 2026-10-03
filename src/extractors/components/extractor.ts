// src/extractors/components/extractor.mts

import type {FigmaNode, FigmaColor, FigmaEffect} from '../../types/figma.js';
import type {
    ComponentMetadata,
    LayoutInfo,
    StylingInfo,
    ComponentChild,
    NestedComponentInfo,
    CategorizedEffects,
    ColorInfo,
    StrokeInfo,
    CornerRadii,
    PaddingInfo,
    TextInfo
} from './types.js';
import {Logger} from '../../utils/logger.js';
import {filterEffectivelyVisibleChildren} from '../../utils/visibility.js';
import {extractComponentProperties} from '../../utils/component-properties.js';
import {convertTypeStyle, convertTextWidget, type TextOverrides, type TextStyleFields} from '../flutter/text-style.js';

/**
 * Extract component metadata
 */
export function extractMetadata(node: FigmaNode, userDefinedAsComponent: boolean): ComponentMetadata {
    const metadata: ComponentMetadata = {
        name: node.name,
        type: node.type as 'COMPONENT' | 'COMPONENT_SET' | 'FRAME',
        nodeId: node.id,
        isUserDefinedComponent: userDefinedAsComponent
    };

    // Add component-specific metadata
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        metadata.componentKey = (node as any).componentKey;
    }

    if (node.type === 'COMPONENT_SET') {
        metadata.variantCount = node.children?.length || 0;
    }

    // INSTANCE (and some COMPONENT) componentProperties including BOOLEAN toggles
    const componentProperties = extractComponentProperties(node);
    if (componentProperties.length > 0) {
        metadata.componentProperties = componentProperties;
    }
    if (node.interactions?.length) {
        metadata.interactions = node.interactions;
    }

    return metadata;
}

/**
 * Extract layout information
 */
export function extractLayoutInfo(node: FigmaNode): LayoutInfo {
    const layout: LayoutInfo = {
        type: determineLayoutType(node),
        layoutMode: node.layoutMode,
        dimensions: {
            width: node.absoluteBoundingBox?.width ?? 0,
            height: node.absoluteBoundingBox?.height ?? 0
        },
        ...(node.absoluteBoundingBox ? {} : {boundsMissing: true}),
        sizingHorizontal: node.layoutSizingHorizontal,
        sizingVertical: node.layoutSizingVertical,
        layoutAlign: node.layoutAlign,
        layoutGrow: node.layoutGrow,
        origin: {x: node.absoluteBoundingBox?.x || 0, y: node.absoluteBoundingBox?.y || 0},
        positioning: node.layoutPositioning,
        clipsContent: node.clipsContent,
        cornerRadius: node.rectangleCornerRadii ?? node.cornerRadius,
        rotation: node.rotation,
        reverseZIndex: node.itemReverseZIndex,
        minWidth: node.minWidth ?? undefined,
        maxWidth: node.maxWidth ?? undefined,
        minHeight: node.minHeight ?? undefined,
        maxHeight: node.maxHeight ?? undefined
    };

    // GRID auto layout: reported as Figma names it, placed by its children's positions (no Row or Column).
    if (node.layoutMode === 'GRID') {
        layout.grid = {rows: node.gridRowCount, columns: node.gridColumnCount, rowGap: node.gridRowGap, columnGap: node.gridColumnGap};
    }

    // Auto-layout specific properties
    if (layout.type === 'auto-layout') {
        layout.direction = node.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical';
        layout.spacing = node.itemSpacing || 0;

        // Extract padding
        if (hasPadding(node)) {
            layout.padding = extractPadding(node);
        }

        // Alignment properties
        layout.alignItems = (node as any).primaryAxisAlignItems;
        layout.justifyContent = (node as any).counterAxisAlignItems;
        layout.mainAxisAlignment = node.primaryAxisAlignItems;
        layout.crossAxisAlignment = node.counterAxisAlignItems;
    }

    // Constraints
    if (node.constraints) {
        layout.constraints = node.constraints;
    }

    return layout;
}

/**
 * Extract styling information
 */
export function extractStylingInfo(node: FigmaNode): StylingInfo {
    const styling: StylingInfo = {};

    // Fills (background colors/gradients)
    if (node.fills && node.fills.length > 0) {
        styling.fills = node.fills.filter(fill => fill.visible !== false).map(convertFillToColorInfo);
    }

    // Strokes (borders) — weight/align are node-level in Figma REST
    if (node.strokes && node.strokes.length > 0) {
        styling.strokes = node.strokes
            .filter((stroke) => stroke.visible !== false)
            .map((stroke) => convertStrokeInfo(stroke, node));
    }

    // Effects (shadows, blurs)
    if (node.effects && node.effects.length > 0) {
        styling.effects = categorizeEffects(node.effects);
    }

    // Corner radius
    const cornerRadius = extractCornerRadius(node);
    if (cornerRadius) {
        styling.cornerRadius = cornerRadius;
    }

    // Opacity
    if ((node as any).opacity !== undefined && (node as any).opacity !== 1) {
        styling.opacity = (node as any).opacity;
    }

    return styling;
}

/**
 * Create nested component information
 */
export function createNestedComponentInfo(node: FigmaNode): NestedComponentInfo {
    return {
        nodeId: node.id,
        name: node.name,
        componentKey: (node as any).componentKey,
        masterComponent: (node as any).masterComponent?.key,
        isComponentInstance: node.type === 'INSTANCE',
        needsSeparateAnalysis: true,
        instanceType: node.type as 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE'
    };
}

/**
 * Create component child information
 */
export function createComponentChild(
    node: FigmaNode,
    isNestedComponent: boolean,
    includeHiddenNodes: boolean,
    parent?: FigmaNode,
    siblings?: FigmaNode[]
): ComponentChild {
    const basicInfo: NonNullable<ComponentChild['basicInfo']> = {
        layout: extractBasicLayout(node)
    };
    const child: ComponentChild = {
        nodeId: node.id,
        name: node.name,
        type: node.type,
        isNestedComponent,
        basicInfo,
        ...(node.interactions?.length ? {interactions: node.interactions} : {})
    };

    // Extract basic info for non-component children
    if (!isNestedComponent) {
        basicInfo.styling = extractBasicStyling(node);

        // Extract text info for text nodes
        if (node.type === 'TEXT') {
            basicInfo.text = extractTextInfo(node, parent, siblings);
        }
    }

    if (node.children) {
        const visibleChildren = filterEffectivelyVisibleChildren(node.children, includeHiddenNodes);
        child.children = visibleChildren.map(nestedChild => createComponentChild(
            nestedChild,
            isComponentNode(nestedChild),
            includeHiddenNodes,
            node,
            visibleChildren.filter(sibling => sibling.id !== nestedChild.id)
        ));
    }

    return child;
}

/**
 * Check if node is a component
 */
export function isComponentNode(node: FigmaNode): boolean {
    return node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'COMPONENT_SET';
}

/**
 * Determine layout type from node properties
 */
export function determineLayoutType(node: FigmaNode): 'auto-layout' | 'absolute' | 'frame' {
    // REST can send layoutMode NONE for a frame without auto layout.
    // GRID is placed by its children's positions (like a frame), not as a Row or Column.
    if (node.layoutMode && node.layoutMode !== 'NONE' && node.layoutMode !== 'GRID') {
        return 'auto-layout';
    }
    if (node.type === 'FRAME' || node.type === 'COMPONENT') {
        return 'frame';
    }
    return 'absolute';
}

/**
 * Check if node has padding
 */
export function hasPadding(node: FigmaNode): boolean {
    return !!(node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft);
}

/**
 * Extract padding information
 */
export function extractPadding(node: FigmaNode): PaddingInfo {
    const top = node.paddingTop || 0;
    const right = node.paddingRight || 0;
    const bottom = node.paddingBottom || 0;
    const left = node.paddingLeft || 0;

    return {
        top,
        right,
        bottom,
        left,
        isUniform: top === right && right === bottom && bottom === left
    };
}

/**
 * Convert fill to color info
 */
export function convertFillToColorInfo(fill: any): ColorInfo {
    const colorInfo: ColorInfo = {
        type: fill.type,
        opacity: fill.opacity,
        ...(fill.blendMode && fill.blendMode !== 'NORMAL' ? {blendMode: fill.blendMode} : {})
    };

    if (fill.color) {
        colorInfo.color = fill.color;
        colorInfo.hex = rgbaToHex(fill.color);
    }

    if (fill.gradientStops) {
        colorInfo.gradientStops = fill.gradientStops;
    }

    return colorInfo;
}

/**
 * Convert stroke paint + node-level weight/align to stroke info.
 */
export function convertStrokeInfo(stroke: any, node?: FigmaNode): StrokeInfo {
    return {
        type: stroke.type,
        color: stroke.color,
        hex: rgbaToHex(stroke.color),
        ...(stroke.opacity !== undefined ? {opacity: stroke.opacity} : {}),
        weight: node?.strokeWeight ?? stroke.strokeWeight,
        ...(node?.individualStrokeWeights ? {individualWeights: node.individualStrokeWeights} : {}),
        align: node?.strokeAlign ?? stroke.strokeAlign
    };
}

/**
 * Categorize effects for Flutter mapping
 */
export function categorizeEffects(effects: FigmaEffect[]): CategorizedEffects {
    const categorized: CategorizedEffects = {
        dropShadows: [],
        innerShadows: [],
        blurs: []
    };

    effects.forEach(effect => {
        if (effect.type === 'DROP_SHADOW' && effect.visible !== false) {
            categorized.dropShadows.push({
                color: effect.color!,
                hex: rgbaToHex(effect.color!),
                offset: effect.offset,
                radius: effect.radius,
                spread: effect.spread,
                opacity: effect.color?.a ?? 1
            });
        } else if (effect.type === 'INNER_SHADOW' && effect.visible !== false) {
            categorized.innerShadows.push({
                color: effect.color!,
                hex: rgbaToHex(effect.color!),
                offset: effect.offset,
                radius: effect.radius,
                spread: effect.spread,
                opacity: effect.color?.a ?? 1
            });
        } else if ((effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') && effect.visible !== false) {
            categorized.blurs.push({
                type: effect.type,
                radius: effect.radius
            });
        }
    });

    return categorized;
}

/**
 * Extract corner radius
 */
export function extractCornerRadius(node: FigmaNode): number | CornerRadii | undefined {
    const nodeAny = node as any;

    if (nodeAny.cornerRadius !== undefined) {
        return nodeAny.cornerRadius;
    }

    // Check for individual corner radii
    if (nodeAny.rectangleCornerRadii && Array.isArray(nodeAny.rectangleCornerRadii)) {
        const [topLeft, topRight, bottomRight, bottomLeft] = nodeAny.rectangleCornerRadii;
        const isUniform = topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft;

        if (isUniform) {
            return topLeft;
        }

        return {
            topLeft,
            topRight,
            bottomLeft,
            bottomRight,
            isUniform: false
        };
    }

    return undefined;
}

/**
 * Extract basic layout info for non-component children
 */
export function extractBasicLayout(node: FigmaNode): Partial<LayoutInfo> {
    return extractLayoutInfo(node);
}

/**
 * Extract basic styling info for non-component children
 */
export function extractBasicStyling(node: FigmaNode): Partial<StylingInfo> {
    const styling: Partial<StylingInfo> = {};

    if (node.fills && node.fills.length > 0) {
        styling.fills = node.fills.filter(fill => fill.visible !== false).map(convertFillToColorInfo);
    }

    if (node.strokes && node.strokes.length > 0) {
        styling.strokes = node.strokes
            .filter((stroke) => stroke.visible !== false)
            .map((stroke) => convertStrokeInfo(stroke, node));
    }

    const cornerRadius = extractCornerRadius(node);
    if (cornerRadius) {
        styling.cornerRadius = cornerRadius;
    }

    return styling;
}

/** The TextStyle inputs of a TEXT node, or undefined when the node carries no style. */
export function textStyleFields(node: FigmaNode): TextStyleFields | undefined {
    return node.style ? convertTypeStyle(node.style, node.fills?.[0]) : undefined;
}

/**
 * A text node's character style overrides. Their indices address node.characters, so they apply
 * only when the emitted content is exactly that string (not trimmed or taken from elsewhere).
 */
function textOverrides(node: FigmaNode, content: string): TextOverrides | undefined {
    if (node.characters !== content) return undefined;
    return {characterStyleOverrides: node.characterStyleOverrides, styleOverrideTable: node.styleOverrideTable, baseFill: node.fills?.[0]};
}

/**
 * Extract enhanced text information
 */
export function extractTextInfo(node: FigmaNode, parent?: FigmaNode, siblings?: FigmaNode[]): TextInfo | undefined {
    if (node.type !== 'TEXT') return undefined;

    const textContent = getActualTextContent(node);

    return {
        content: textContent,
        fontFamily: node.style?.fontFamily,
        fontSize: node.style?.fontSize,
        fontWeight: node.style?.fontWeight,
        textAlign: node.style?.textAlignHorizontal,
        style: textStyleFields(node),
        widget: convertTextWidget(textContent, node.style, node.absoluteBoundingBox?.height, textOverrides(node, textContent)),
        textCase: detectTextCase(textContent)
    };
}

/**
 * Get actual text content from various sources
 */
function getActualTextContent(node: FigmaNode): string {
    // 1. Primary source: characters property (official Figma API text content)
    if (node.characters && node.characters.trim().length > 0) {
        return node.characters.trim();
    }

    // 2. Check fills for text content (sometimes stored in fill metadata)
    if (node.fills) {
        for (const fill of node.fills) {
            if ((fill as any).textData || (fill as any).content) {
                const textContent = (fill as any).textData || (fill as any).content;
                if (textContent && textContent.trim().length > 0) {
                    return textContent.trim();
                }
            }
        }
    }

    // 3. Fallback: the node name
    return node.name;
}

/**
 * Detect text case pattern
 */
function detectTextCase(content: string): 'uppercase' | 'lowercase' | 'capitalize' | 'sentence' | 'mixed' {
    if (content.length === 0) return 'mixed';

    const isAllUpper = content === content.toUpperCase() && content !== content.toLowerCase();
    const isAllLower = content === content.toLowerCase() && content !== content.toUpperCase();

    if (isAllUpper) return 'uppercase';
    if (isAllLower) return 'lowercase';

    // Check if it's title case (first letter of each word capitalized)
    const words = content.split(/\s+/);
    const isTitleCase = words.every(word => {
        return word.length === 0 || word[0] === word[0].toUpperCase();
    });

    if (isTitleCase) return 'capitalize';

    // Check if it's sentence case (first letter capitalized, rest normal)
    if (content[0] === content[0].toUpperCase()) {
        return 'sentence';
    }

    return 'mixed';
}

/**
 * Convert RGBA color to hex string
 */
export function rgbaToHex(color: FigmaColor): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}