// src/extractors/typography/extractor.mts

import type {FigmaNode, FigmaTextStyle} from '../../types/figma.js';
import type {
    TypographyStyle,
    TypographyExtractionContext,
    TypographyExtractorFn
} from './types.js';

/**
 * Extract typography styles from a frame of text samples
 */
export function extractTypographyFromThemeFrame(frameNode: FigmaNode): TypographyStyle[] {
    const typography: TypographyStyle[] = [];

    // Find all child nodes in the frame
    if (!frameNode.children) {
        return typography;
    }

    // Look for text nodes only, ignore frames and other nodes that might be for colors
    frameNode.children.forEach(child => {
        // Only process direct text nodes or groups/frames that contain text
        if (child.type === 'TEXT') {
            const textStyle = createTypographyStyle(child);
            if (textStyle) {
                typography.push(textStyle);
            }
        } else if (child.children) {
            // For groups/frames, only look for immediate text children
            child.children.forEach(grandchild => {
                if (grandchild.type === 'TEXT') {
                    const textStyle = createTypographyStyle(grandchild);
                    if (textStyle) {
                        typography.push(textStyle);
                    }
                }
            });
        }
    });

    return typography;
}

/**
 * Create typography style from text node
 */
function createTypographyStyle(node: FigmaNode): TypographyStyle | null {
    if (!node.style) {
        return null;
    }

    // Get typography name from node name or generate one
    const typographyName = getTypographyName(node);
    if (!typographyName) {
        return null;
    }

    // Ensure we have a valid font family, fallback to system default if needed
    const fontFamily = node.style.fontFamily && node.style.fontFamily.trim() !== ''
        ? node.style.fontFamily.trim()
        : 'Roboto'; // Flutter's default font

    return {
        name: typographyName,
        fontFamily: fontFamily,
        fontSize: node.style.fontSize || 16,
        fontWeight: node.style.fontWeight || 400,
        lineHeight: node.style.lineHeightPx || (node.style.fontSize || 16) * 1.2,
        letterSpacing: node.style.letterSpacing || 0,
        nodeId: node.id,
        textAlign: node.style.textAlignHorizontal,
    };
}

/**
 * Get typography name from node or generate meaningful name
 */
function getTypographyName(node: FigmaNode): string | null {
    // Always prioritize the actual node name from Figma first
    if (node.name && node.name.trim() && !isTypographyDemoNode(node)) {
        return cleanTypographyName(node.name);
    }

    // Fallback to style-based generation only if no meaningful name
    if (node.style) {
        return generateTypographyNameFromStyle(node.style);
    }

    return null;
}

/**
 * Check if node is a typography demo/sample and should be excluded
 */
export function isTypographyDemoNode(node: FigmaNode): boolean {
    const demoKeywords = [
        // Lorem ipsum and common demo text
        'lorem', 'ipsum', 'dolor', 'sit', 'amet',
        'sample text', 'example text', 'demo text', 'placeholder text',
        'the quick brown', 'abcdefg', 'test text',

        // Demo indicators
        'sample', 'example', 'demo', 'placeholder', 'preview',
        'specimen', 'showcase', 'test'
    ];

    const nodeName = node.name.toLowerCase();

    // Check node name against demo keywords
    const isDemoByName = demoKeywords.some(keyword =>
        nodeName.includes(keyword.toLowerCase())
    );

    // Check if node name is very generic (likely demo text)
    const isGenericName = /^(text|label|title|heading|body)(\s*\d+)?$/i.test(node.name.trim());

    return isDemoByName || isGenericName;
}

/**
 * Clean up typography name for use as identifier while preserving original naming
 */
function cleanTypographyName(name: string): string {
    // First, clean up the name but preserve the original structure
    let cleaned = name
        .trim()
        .replace(/\s+/g, ' '); // Normalize whitespace

    // Only remove common prefixes/suffixes if they're clearly not part of the intended name
    if (cleaned.toLowerCase().startsWith('text ') && cleaned.split(' ').length > 1) {
        cleaned = cleaned.substring(5);
    }
    if (cleaned.toLowerCase().endsWith(' style') && cleaned.split(' ').length > 1) {
        cleaned = cleaned.substring(0, cleaned.length - 6);
    }

    // Convert to PascalCase while preserving meaningful word boundaries
    return cleaned
        .split(/[\s\-_]+/)
        .filter(word => word.length > 0)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
}

/**
 * Generate typography name from style properties
 */
function generateTypographyNameFromStyle(style: FigmaTextStyle): string {
    const fontSize = style.fontSize || 16;
    const fontWeight = style.fontWeight || 400;

    // Categorize by size
    let sizeName = 'Body';
    if (fontSize >= 32) sizeName = 'DisplayLarge';
    else if (fontSize >= 28) sizeName = 'DisplayMedium';
    else if (fontSize >= 24) sizeName = 'DisplaySmall';
    else if (fontSize >= 22) sizeName = 'HeadlineLarge';
    else if (fontSize >= 20) sizeName = 'HeadlineMedium';
    else if (fontSize >= 18) sizeName = 'HeadlineSmall';
    else if (fontSize >= 16) sizeName = 'BodyLarge';
    else if (fontSize >= 14) sizeName = 'BodyMedium';
    else if (fontSize >= 12) sizeName = 'BodySmall';
    else if (fontSize >= 11) sizeName = 'LabelLarge';
    else if (fontSize >= 10) sizeName = 'LabelMedium';
    else sizeName = 'LabelSmall';

    // Add weight if not regular
    if (fontWeight >= 700) {
        sizeName += 'Bold';
    } else if (fontWeight >= 600) {
        sizeName += 'SemiBold';
    } else if (fontWeight >= 500) {
        sizeName += 'Medium';
    } else if (fontWeight <= 300) {
        sizeName += 'Light';
    }

    return sizeName;
}

