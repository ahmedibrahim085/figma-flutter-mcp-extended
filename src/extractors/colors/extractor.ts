// src/extractors/colors/extractor.mts

import type {FigmaNode} from '../../types/figma.js';
import type {ThemeColor} from './types.js';
import {convertFillToColorInfo} from '../components/extractor.js';

/**
 * Extract the colors of a frame of color samples: one per child that has a visible solid fill.
 */
export function extractColorsFromThemeFrame(frameNode: FigmaNode, styleNames: Record<string, {name: string}> = {}): ThemeColor[] {
    const colors: ThemeColor[] = [];
    for (const child of frameNode.children ?? []) {
        const color = extractColorFromNode(child, styleNames);
        if (color) colors.push(color);
    }
    return colors;
}

/**
 * A swatch is named by its fill style, else its bound variable (named later, when the
 * variables endpoint answers), else its layer name.
 */
function extractColorFromNode(node: FigmaNode, styleNames: Record<string, {name: string}>): ThemeColor | null {
    const found = findSolidFill(node);
    if (!found) return null;

    const styleId = found.node.styles?.fill ?? found.node.styles?.fills;
    const styleName = styleId ? styleNames[styleId]?.name : undefined;
    const variableId = styleName ? undefined : found.fill.boundVariables?.color?.id;
    return {
        name: styleName ?? node.name,
        fill: convertFillToColorInfo(found.fill),
        nodeId: node.id,
        ...(variableId ? {variableId} : {}),
    };
}

/**
 * The first visible solid fill, looking at child shapes before the node itself: a swatch cell's
 * own background (often white) is not the documented colour; the swatch inside it is.
 */
function findSolidFill(node: FigmaNode): {fill: NonNullable<FigmaNode['fills']>[number]; node: FigmaNode} | null {
    for (const child of node.children ?? []) {
        if (child.type === 'RECTANGLE' || child.type === 'FRAME') {
            const found = findSolidFill(child);
            if (found) return found;
        }
    }
    const fill = node.fills?.find(f => f.type === 'SOLID' && f.color && f.visible !== false);
    return fill ? {fill, node} : null;
}
