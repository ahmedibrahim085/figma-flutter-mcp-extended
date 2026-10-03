// src/extractors/typography/extractor.mts

import type {FigmaNode} from '../../types/figma.js';
import type {TypographyStyle} from './types.js';
import {convertTypeStyle} from '../flutter/text-style.js';

type StyleMap = Record<string, {name: string; styleType: string}>;

/**
 * Extract typography styles from a frame of text samples: every TEXT node that is a direct child
 * of the frame or of one of its groups, in frame order.
 */
export function extractTypographyFromThemeFrame(frameNode: FigmaNode, styles: StyleMap = {}): TypographyStyle[] {
    const typography: TypographyStyle[] = [];
    const add = (node: FigmaNode) => {
        const style = createTypographyStyle(node, styles);
        if (style) typography.push(style);
    };

    frameNode.children?.forEach(child => {
        if (child.type === 'TEXT') add(child);
        else child.children?.forEach(grandchild => grandchild.type === 'TEXT' && add(grandchild));
    });

    return typography;
}

/** The name is the text style's name when the node uses one, else the layer name. */
function createTypographyStyle(node: FigmaNode, styles: StyleMap): TypographyStyle | null {
    if (!node.style) {
        return null;
    }
    const styleId = node.styles?.text;
    const type = node.style;
    const unsupported = [
        type.textCase === 'UPPER' || type.textCase === 'LOWER' || type.textCase === 'TITLE' ? `textCase ${type.textCase}` : '',
        type.paragraphSpacing ? `paragraphSpacing ${type.paragraphSpacing}` : '',
        type.paragraphIndent ? `paragraphIndent ${type.paragraphIndent}` : '',
    ].filter(Boolean);

    return {
        name: (styleId && styles[styleId]?.name) || node.name,
        nodeId: node.id,
        fields: convertTypeStyle(type),
        unsupported,
    };
}
