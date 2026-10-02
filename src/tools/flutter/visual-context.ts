// src/tools/flutter/visual-context.ts

import type { ComponentAnalysis } from '../../extractors/components/types.js';
import type { ScreenAnalysis } from '../../extractors/screens/types.js';

/**
 * Generate visual context for component analysis
 */
export function generateComponentVisualContext(
    analysis: ComponentAnalysis, 
    figmaUrl?: string,
    nodeId?: string
): string {
    let context = `📐 Layout map for AI Implementation:\n`;
    context += `${'='.repeat(50)}\n\n`;

    // Design reference
    if (figmaUrl) {
        context += `🎨 Design Reference:\n`;
        context += `   • Figma URL: ${figmaUrl}\n`;
        if (nodeId) {
            context += `   • Node ID: ${nodeId}\n`;
        }
        context += `   • Component: ${analysis.metadata.name}\n`;
        context += `   • Type: ${analysis.metadata.type}\n\n`;
    }

    // ASCII layout representation
    context += `📏 Layout Structure:\n`;
    context += generateComponentAsciiLayout(analysis);
    context += `\n`;

    // Spatial relationships
    context += `📍 Spatial Relationships:\n`;
    context += generateComponentSpatialDescription(analysis);
    context += `\n`;

    // Visual patterns
    context += `🎯 Visual Design Patterns:\n`;
    context += generateComponentPatternDescription(analysis);
    context += `\n`;

    // Implementation guidance
    context += `💡 Implementation Guidance:\n`;
    context += generateComponentImplementationHints(analysis);
    
    // Semantic detection information
    context += `\n🧠 Name-based layer classification:\n`;
    context += `   • Multi-factor analysis with confidence scoring\n`;
    context += `   • Context-aware classification using position and parent information\n`;
    context += `   • Design pattern recognition for improved accuracy\n`;
    context += `   • Fallback to legacy detection for low-confidence classifications\n`;
    context += `   • Reduced false positives through evidence-based classification\n`;

    return context;
}

/**
 * Generate visual context for screen analysis: where to find the design to compare against.
 */
export function generateScreenVisualContext(
    analysis: ScreenAnalysis,
    figmaUrl?: string,
    nodeId?: string
): string {
    let context = `📱 Screen layout map for AI Implementation:\n`;
    context += `${'='.repeat(55)}\n\n`;

    // Design reference
    if (figmaUrl) {
        context += `🎨 Design Reference:\n`;
        context += `   • Figma URL: ${figmaUrl}\n`;
        if (nodeId) {
            context += `   • Node ID: ${nodeId}\n`;
        }
        context += `   • Screen: ${analysis.metadata.name}\n`;
        context += `   • Device: ${analysis.metadata.deviceType} (${analysis.metadata.orientation})\n\n`;
        context += `🔗 Reference for Verification:\n`;
        context += `   View the original design at: ${figmaUrl}\n`;
        context += `   Use this to verify your implementation matches the intended visual design.\n`;
    }

    return context;
}

/**
 * Generate ASCII layout for component
 */
function generateComponentAsciiLayout(analysis: ComponentAnalysis): string {
    const width = Math.min(Math.max(Math.round(analysis.layout.dimensions.width / 20), 10), 50);
    const height = Math.min(Math.max(Math.round(analysis.layout.dimensions.height / 20), 3), 10);
    
    let ascii = `┌${'─'.repeat(width)}┐\n`;
    
    // Add component name in the middle
    const nameLines = Math.floor(height / 2);
    for (let i = 0; i < height; i++) {
        if (i === nameLines) {
            const name = analysis.metadata.name.substring(0, width - 2);
            const padding = Math.max(0, Math.floor((width - name.length) / 2));
            ascii += `│${' '.repeat(padding)}${name}${' '.repeat(width - padding - name.length)}│\n`;
        } else {
            ascii += `│${' '.repeat(width)}│\n`;
        }
    }
    
    ascii += `└${'─'.repeat(width)}┘\n`;
    ascii += `Dimensions: ${Math.round(analysis.layout.dimensions.width)}×${Math.round(analysis.layout.dimensions.height)}px\n`;
    
    // Add layout type indicator
    if (analysis.layout.type === 'auto-layout') {
        const direction = analysis.layout.direction === 'horizontal' ? '↔' : '↕';
        ascii += `Layout: Auto-layout ${direction} (${analysis.layout.direction})\n`;
        if (analysis.layout.spacing) {
            ascii += `Spacing: ${analysis.layout.spacing}px\n`;
        }
    }

    return ascii;
}

/**
 * Generate component spatial description
 */
function generateComponentSpatialDescription(analysis: ComponentAnalysis): string {
    let description = '';
    
    // Layout analysis
    if (analysis.layout.type === 'auto-layout') {
        description += `   • Layout flow: ${analysis.layout.direction} auto-layout\n`;
        if (analysis.layout.spacing) {
            description += `   • Element spacing: ${analysis.layout.spacing}px consistent\n`;
        }
        const crossAxisAlignment =
            analysis.layout.crossAxisAlignment ?? analysis.layout.justifyContent;
        if (crossAxisAlignment) {
            description += `   • Cross-axis alignment: ${crossAxisAlignment}\n`;
        }
        const mainAxisAlignment =
            analysis.layout.mainAxisAlignment ?? analysis.layout.alignItems;
        if (mainAxisAlignment) {
            description += `   • Main-axis alignment: ${mainAxisAlignment}\n`;
        }
    } else {
        description += `   • Layout flow: absolute positioning\n`;
    }

    // Padding analysis
    if (analysis.layout.padding) {
        const p = analysis.layout.padding;
        if (p.isUniform) {
            description += `   • Internal padding: ${p.top}px uniform\n`;
        } else {
            description += `   • Internal padding: ${p.top}px ${p.right}px ${p.bottom}px ${p.left}px (TRBL)\n`;
        }
    }

    // Children positioning
    if (analysis.children.length > 0) {
        description += `   • Contains ${analysis.children.length} child layers\n`;
        const highImportanceChildren = analysis.children.filter(c => c.visualImportance >= 7);
        if (highImportanceChildren.length > 0) {
            description += `   • ${highImportanceChildren.length} high-priority elements (visual weight ≥7)\n`;
        }
    }

    return description;
}

/**
 * Generate component pattern description
 */
function generateComponentPatternDescription(analysis: ComponentAnalysis): string {
    let patterns = '';
    
    // Layout pattern
    patterns += `   • Layout type: ${analysis.layout.type}\n`;
    
    // Spacing pattern
    if (analysis.layout.spacing !== undefined) {
        patterns += `   • Spacing system: ${analysis.layout.spacing}px consistent\n`;
    }
    
    // Visual styling patterns
    if (analysis.styling.fills && analysis.styling.fills.length > 0) {
        const primaryColor = analysis.styling.fills[0].hex;
        patterns += `   • Color pattern: Primary ${primaryColor}\n`;
    }
    
    if (analysis.styling.cornerRadius !== undefined) {
        const radius = typeof analysis.styling.cornerRadius === 'number' 
            ? analysis.styling.cornerRadius 
            : `${analysis.styling.cornerRadius.topLeft}px mixed`;
        patterns += `   • Border radius: ${radius}px consistent\n`;
    }
    
    // Component grouping
    if (analysis.children.length > 0) {
        const componentChildren = analysis.children.filter(c => c.isNestedComponent).length;
        if (componentChildren > 0) {
            patterns += `   • Component composition: ${componentChildren}/${analysis.children.length} nested components\n`;
        }
    }

    // Visual weight
    const textElements = analysis.children.filter(c => c.type === 'TEXT').length;
    const visualElements = analysis.children.length - textElements;
    patterns += `   • Content balance: ${textElements} text, ${visualElements} visual elements\n`;

    return patterns;
}

/**
 * Generate component implementation hints
 */
function generateComponentImplementationHints(analysis: ComponentAnalysis): string {
    let hints = '';
    
    // Main container suggestion
    if (analysis.layout.type === 'auto-layout') {
        const widget = analysis.layout.direction === 'horizontal' ? 'Row' : 'Column';
        hints += `   • Main container: Use ${widget}() for ${analysis.layout.direction} layout\n`;
        if (analysis.layout.spacing) {
            hints += `   • Spacing: Add SizedBox gaps of ${analysis.layout.spacing}px\n`;
        }
    } else {
        hints += `   • Main container: Use Stack() or Container() for absolute positioning\n`;
    }
    
    // Styling approach
    if (analysis.styling.fills || analysis.styling.strokes || analysis.styling.cornerRadius !== undefined) {
        hints += `   • Styling: Implement BoxDecoration for visual styling\n`;
    }
    
    // Text handling
    const textChildren = analysis.children.filter(c => c.type === 'TEXT');
    if (textChildren.length > 0) {
        hints += `   • Text elements: ${textChildren.length} Text() widgets with custom styling\n`;
    }
    
    // Component composition
    const nestedComponents = analysis.children.filter(c => c.isNestedComponent);
    if (nestedComponents.length > 0) {
        hints += `   • Component structure: Break down ${nestedComponents.length} nested components\n`;
    }
    
    // Responsive considerations
    if (analysis.layout.dimensions.width > 400) {
        hints += `   • Responsive: Consider MediaQuery for larger screens\n`;
    }

    return hints;
}

