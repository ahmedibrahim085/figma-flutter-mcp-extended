// src/extractors/colors/extractor.mts

import type {FigmaNode} from '../../types/figma.js';
import type {
    ThemeColor,
    ColorExtractorFn
} from './types.js';

/**
 * Extract colors from a frame of color samples with text labels
 */
export function extractColorsFromThemeFrame(frameNode: FigmaNode): ThemeColor[] {
    const colors: ThemeColor[] = [];

    // Find all child nodes in the frame
    if (!frameNode.children) {
        return colors;
    }

    // Look for color swatches (rectangles/frames) with text labels
    frameNode.children.forEach(child => {
        const colorInfo = extractColorFromNode(child);
        if (colorInfo) {
            colors.push(colorInfo);
        }
    });

    return colors;
}

/**
 * Extract color from a single node (used by color frame extraction)
 */
function extractColorFromNode(node: FigmaNode): ThemeColor | null {
    // Skip typography-related nodes — but a node holding a swatch shape is a colour swatch even when
    // its name is also a font-weight word ("Black", "Light", "Medium").
    if (isTypographyNode(node) && !hasSwatchShape(node)) {
        return null;
    }

    // Check if this node has a solid fill (color swatch)
    const colorHex = getNodeColor(node);
    if (!colorHex) {
        return null;
    }

    // Get the color name from the node name or any text children
    const colorName = getColorName(node);
    if (!colorName) {
        return null;
    }

    return {
        name: colorName,
        hex: colorHex,
        nodeId: node.id
    };
}

/**
 * Get color from node fills or child nodes
 */
function getNodeColor(node: FigmaNode): string | null {
    // Check children first: a swatch cell's own background (often white) is not the documented colour;
    // the swatch inside it is.
    if (node.children) {
        for (const child of node.children) {
            if (child.type === 'RECTANGLE' || child.type === 'FRAME') {
                const childColor = getNodeColor(child);
                if (childColor) {
                    return childColor;
                }
            }
        }
    }

    // Check node fills for solid color
    if (node.fills && Array.isArray(node.fills)) {
        for (const fill of node.fills) {
            if (fill.type === 'SOLID' && fill.color && fill.visible !== false) {
                return rgbaToHex(fill.color);
            }
        }
    }

    return null;
}

/**
 * True when the node is, or directly contains, a swatch shape.
 */
function hasSwatchShape(node: FigmaNode): boolean {
    const isShape = (n: FigmaNode) => n.type === 'RECTANGLE' || n.type === 'ELLIPSE';
    return isShape(node) || !!node.children?.some(isShape);
}

/**
 * Get color name from node or text children
 */
function getColorName(node: FigmaNode): string | null {
    // First, try to get name from text children
    const textName = findTextInNode(node);
    if (textName) {
        return cleanColorName(textName);
    }

    // Fallback to node name if it looks like a color name
    if (node.name && isColorName(node.name)) {
        return cleanColorName(node.name);
    }

    return null;
}

/**
 * Find text content in node or children
 */
function findTextInNode(node: FigmaNode): string | null {
    // Check if this node is text
    if (node.type === 'TEXT' && node.name) {
        return node.name;
    }

    // Check children for text nodes
    if (node.children) {
        for (const child of node.children) {
            if (child.type === 'TEXT' && child.name) {
                return child.name;
            }
            // Recursively check nested children
            const nestedText = findTextInNode(child);
            if (nestedText) {
                return nestedText;
            }
        }
    }

    return null;
}

/**
 * Check if name looks like a color name
 */
function isColorName(name: string): boolean {
    const colorKeywords = [
        'primary', 'secondary', 'accent', 'background', 'surface',
        'text', 'foreground', 'danger', 'error', 'success', 'warning',
        'info', 'light', 'dark', 'grey', 'gray', 'white', 'black'
    ];

    const lowerName = name.toLowerCase();
    return colorKeywords.some(keyword => lowerName.includes(keyword));
}

/**
 * Check if node is typography-related and should be excluded from color extraction
 */
export function isTypographyNode(node: FigmaNode): boolean {
    const typographyKeywords = [
        // Typography size variations
        'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'title1', 'title2', 'title3',
        'subtitle1', 'subtitle2', 'subtitle3',
        'body1', 'body2', 'body3',
        'caption1', 'caption2', 'caption3',
        'label1', 'label2', 'label3',
        'overline1', 'overline2', 'overline3',
        
        // Typography style variations
        'headline', 'subheading', 'subhead',
        'display', 'title', 'subtitle', 'body', 'caption', 'overline', 'label',
        'text-lg', 'text-md', 'text-sm', 'text-xs',
        'large', 'medium', 'small', 'extra-small',
        
        // Typography weight variations
        'regular', 'medium', 'semibold', 'bold', 'light', 'thin',
        'normal', 'heavy', 'black',
        
        // Common typography examples
        'paragraph', 'lorem', 'ipsum', 'sample text', 'example text',
        'placeholder', 'demo text', 'text example',
        
        // Font-related terms
        'font', 'typeface', 'typography', 'text style'
    ];

    const nodeName = node.name.toLowerCase().replace(/\s+/g, '');
    
    // Check node name against typography keywords
    const isTypographyByName = typographyKeywords.some(keyword => 
        nodeName.includes(keyword.toLowerCase().replace(/\s+/g, ''))
    );
    
    // Check if node contains only text children (likely a typography example)
    const isTextOnlyNode = !!(node.children && node.children.length > 0 && 
        node.children.every(child => child.type === 'TEXT'));
    
    // Check if parent or grandparent has typography-related names
    const hasTypographyContext = checkTypographyContext(node, typographyKeywords);
    
    return isTypographyByName || (isTextOnlyNode && hasTypographyContext);
}

/**
 * Check if node has typography context by examining patterns
 */
function checkTypographyContext(node: FigmaNode, typographyKeywords: string[]): boolean {
    // Look for patterns like "Text Style", "Typography", "Font Examples", etc.
    const contextKeywords = [
        'text style', 'typography', 'font example', 'text example',
        'style guide', 'type scale', 'font scale', 'text scale'
    ];
    
    const nodeName = node.name.toLowerCase().replace(/\s+/g, '');
    return contextKeywords.some(keyword => 
        nodeName.includes(keyword.toLowerCase().replace(/\s+/g, ''))
    );
}

/**
 * Clean up color name for use as identifier
 */
function cleanColorName(name: string): string {
    // Remove common prefixes and clean up the name
    return name
        .replace(/^(color|Color)[\s\-_]*/i, '')
        .replace(/[\s\-_]*(color|Color)$/i, '')
        .trim()
        .replace(/\s+/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
}

/**
 * Convert RGBA color to hex string
 */
function rgbaToHex(color: {r: number; g: number; b: number; a?: number}): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

