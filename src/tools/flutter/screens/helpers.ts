// src/tools/flutter/screens/helpers.mts

import {formatFills} from "../../../utils/paint-format.js";
import {convertFillToColorInfo} from "../../../extractors/components/extractor.js";
import {formatBreakpointLines} from "../../../extractors/screens/breakpoints.js";
import {extractScreenMetadata} from "../../../extractors/screens/extractor.js";
import {WIDGET_SPLIT_ADVICE} from "../../../utils/flutter-guidance.js";
import type {ScreenAnalysis} from "../../../extractors/screens/types.js";
import type {ComponentChild} from "../../../extractors/components/types.js";
import {generateScreenVisualContext} from "../visual-context.js";
import {filterEffectivelyVisibleChildren} from "../../../utils/visibility.js";
import {
    formatCategorizedEffects,
    formatFigmaEffects
} from "../../../utils/effects-format.js";
import {
    formatVisualBoxEvidence,
    formatFigmaNodeBoxEvidence,
    formatSizingAlignment
} from "../../../utils/style-format.js";
import {generateFigmaUrl} from "../../../utils/figma-url-parser.js";
import {typeName} from "../../../utils/dart-names.js";

export function generateChildLayoutEvidence(
    children: ComponentChild[],
    indent: string = '   '
): string {
    let output = '';

    children.forEach(child => {
        const layout = child.basicInfo?.layout;
        if (layout) {
            const details = [
                layout.dimensions
                    ? `${Math.round(layout.dimensions.width)}×${Math.round(layout.dimensions.height)}px`
                    : undefined,
                layout.sizingHorizontal
                    ? `horizontal=${layout.sizingHorizontal}`
                    : undefined,
                layout.sizingVertical
                    ? `vertical=${layout.sizingVertical}`
                    : undefined,
                layout.layoutAlign
                    ? `parentAlign=${layout.layoutAlign}`
                    : undefined
            ].filter(Boolean);
            output += `${indent}- ${child.name}: ${details.join(', ')}\n`;
        } else {
            output += `${indent}- ${child.name}\n`;
        }

        output += formatVisualBoxEvidence(
            child.basicInfo?.styling,
            child.basicInfo?.layout,
            `${indent}  `
        );

        if (child.children?.length) {
            output += generateChildLayoutEvidence(child.children, `${indent}  `);
        }
    });

    return output;
}

/**
 * Generate comprehensive screen analysis report
 */
export function generateScreenAnalysisReport(
    analysis: ScreenAnalysis,
    parsedInput?: any
): string {
    let output = `Screen Analysis Report\n\n`;

    // Screen metadata
    output += `Screen: ${analysis.metadata.name}\n`;
    output += `Type: ${analysis.metadata.type}\n`;
    output += `Node ID: ${analysis.metadata.nodeId}\n`;
    if (analysis.metadata.dimensions) {
        output += `Dimensions: ${Math.round(analysis.metadata.dimensions.width)}×${Math.round(analysis.metadata.dimensions.height)}px\n`;
    }
    output += formatBreakpointLines(analysis.metadata.dimensions);
    if (parsedInput) {
        output += `Source: ${parsedInput.source === 'url' ? 'Figma URL' : 'Direct input'}\n`;
    }
    output += `\n`;

    // Screen layout information
    output += `Screen Layout:\n`;
    output += `- Layout Type: ${analysis.layout.type}\n`;
    if (analysis.layout.scrollable) {
        output += `- Scrollable: Yes\n`;
    }
    output += `\n`;

    // Child layers, in Figma layer order
    if (analysis.children.length > 0) {
        output += `Child layers (${analysis.children.length} identified):\n`;
        analysis.children.forEach((child, index) => {
            output += `${index + 1}. ${child.name} (${child.type}, ${child.nodeId})\n`;

            if (child.layout.dimensions) {
                const dims = child.layout.dimensions;
                output += `   Size: ${Math.round(dims.width)}×${Math.round(dims.height)}px\n`;
            }
            if (child.bounds) {
                output += `   Position: (${Math.round(child.bounds.x)}, ${Math.round(child.bounds.y)}) in parent\n`;
            }
            output += formatSizingAlignment({
                horizontal: child.layout.sizingHorizontal,
                vertical: child.layout.sizingVertical,
                align: child.layout.layoutAlign
            }, '   ');

            output += formatVisualBoxEvidence(child.styling, child.layout, '   ');
            output += formatCategorizedEffects(child.styling?.effects, '   ');

            if (child.children.length > 0) {
                output += `   Contains: ${child.children.length} elements\n`;
                output += generateChildLayoutEvidence(child.children);
            }

            if (child.components.length > 0) {
                output += `   Components: ${child.components.length} nested component(s)\n`;
            }
        });
        output += `\n`;
        output += formatFixedOnScroll(analysis.children);
    }

    output += `Layout sizing (FIXED/HUG/FILL):\n`;
    output += `- FILL / STRETCH: adapt to the parent's available space; do not hardcode the measured width. Use parent padding, stretch, or Expanded as appropriate.\n`;
    output += `- FIXED: preserve the explicit Figma dimension.\n`;
    output += `- HUG: size to the child content.\n\n`;

    // Nested components for separate analysis
    if (analysis.components.length > 0) {
        output += `Nested Components Found (${analysis.components.length}):\n`;
        output += `These components should be analyzed separately:\n`;
        analysis.components.forEach((comp, index) => {
            output += `${index + 1}. ${comp.name}\n`;
            output += `   Node ID: ${comp.nodeId}\n`;
            output += `   Type: ${comp.instanceType}\n`;
            if (comp.componentKey) {
                output += `   Component Key: ${comp.componentKey}\n`;
            }
        });
        output += `\n`;
    }

    // Visual context for AI implementation
    if (parsedInput?.source === 'url') {
        // Reconstruct the Figma URL from the parsed input
        const figmaUrl = generateFigmaUrl(parsedInput.fileId, parsedInput.nodeId);
        output += generateScreenVisualContext(analysis, figmaUrl, parsedInput.nodeId);
        output += `\n`;
    }

    // Flutter implementation guidance
    output += generateFlutterScreenGuidance(analysis);

    return output;
}

/**
 * Generate screen structure inspection report
 */
export function generateScreenStructureReport(node: any, showAllChildren: boolean): string {
    let output = `Screen Structure Inspection\n\n`;

    output += `Screen: ${node.name}\n`;
    output += `Type: ${node.type}\n`;
    output += `Node ID: ${node.id}\n`;
    output += `Child layers: ${node.children?.length || 0}\n`;

    if (node.absoluteBoundingBox) {
        const bbox = node.absoluteBoundingBox;
        output += `Dimensions: ${Math.round(bbox.width)}×${Math.round(bbox.height)}px\n`;
        output += formatBreakpointLines(extractScreenMetadata(node).dimensions);
    }
    output += formatSizingAlignment({
        horizontal: node.layoutSizingHorizontal,
        vertical: node.layoutSizingVertical,
        align: node.layoutAlign
    });

    output += `\n`;

    if (!node.children || node.children.length === 0) {
        output += `This screen has no child layers.\n`;
        return output;
    }

    const sectionsSource = showAllChildren
        ? node.children
        : filterEffectivelyVisibleChildren(node.children, false);
    const hiddenSkipped = (node.children?.length || 0) - sectionsSource.length;

    output += `Screen Structure:\n`;

    sectionsSource.forEach((section: any, index: number) => {
        const isComponent = section.type === 'COMPONENT' || section.type === 'INSTANCE';
        const componentMark = isComponent ? ' [COMPONENT]' : '';
        const hiddenMark = section.visible === false ? ' [HIDDEN]' : '';
        
        output += `${index + 1}. ${section.name} (${section.type}, ${section.id})${componentMark}${hiddenMark}\n`;

        if (section.absoluteBoundingBox) {
            const bbox = section.absoluteBoundingBox;
            output += `   Size: ${Math.round(bbox.width)}×${Math.round(bbox.height)}px\n`;
            if (node.absoluteBoundingBox) {
                output += `   Position: (${Math.round(bbox.x - node.absoluteBoundingBox.x)}, ${Math.round(bbox.y - node.absoluteBoundingBox.y)}) in parent\n`;
            }
        }
        output += formatSizingAlignment({
            horizontal: section.layoutSizingHorizontal,
            vertical: section.layoutSizingVertical,
            align: section.layoutAlign
        }, '   ');

        if (section.children && section.children.length > 0) {
            output += `   Contains: ${section.children.length} child layers\n`;
            
            // Show component count
            const componentCount = section.children.filter((child: any) => 
                child.type === 'COMPONENT' || child.type === 'INSTANCE'
            ).length;
            if (componentCount > 0) {
                output += `   Components: ${componentCount} nested component(s)\n`;
            }
        }

        // Show basic styling info
        output += formatFills((section.fills ?? []).filter((fill: any) => fill.visible !== false && fill.color).map(convertFillToColorInfo), '   ', '');

        output += formatFigmaNodeBoxEvidence(section, '   ');
        output += formatFigmaEffects(section.effects, '   ');
    });

    output += formatFixedOnScroll(sectionsSource.map((section: any) => ({
        name: section.name, type: section.type, nodeId: section.id, scrollBehavior: section.scrollBehavior
    })));

    if (!showAllChildren && hiddenSkipped > 0) {
        output += `\nSkipped ${hiddenSkipped} hidden / empty-slot child layer(s). Use showAllChildren: true to include them.\n`;
    }

    // Analysis recommendations
    output += `\nAnalysis Recommendations:\n`;
    
    const componentSections = sectionsSource.filter((section: any) =>
        section.type === 'COMPONENT' || section.type === 'INSTANCE'
    );
    if (componentSections.length > 0) {
        output += `- Found ${componentSections.length} component child layers for separate analysis\n`;
    }

    return output;
}

/**
 * Generate Flutter screen implementation guidance
 */
export function generateFlutterScreenGuidance(analysis: ScreenAnalysis): string {
    let guidance = `Flutter Screen Implementation Guidance:\n\n`;

    // Widget composition best practices
    guidance += `🏗️  Widget Composition Best Practices:\n`;
    WIDGET_SPLIT_ADVICE.forEach(line => { guidance += `- ${line}\n`; });
    guidance += `\n`;
    
    guidance += `📱 Safe area:\n`;
    guidance += `- Safe-area insets belong to screen composition, not reusable component heights\n`;
    guidance += `- Use Flutter SafeArea for the screen edges; never hardcode the design inset\n\n`;

    // Main scaffold structure: the child layers in Figma order, no role guessed from a name or a position
    guidance += `Main Screen Structure:\n`;
    guidance += `Scaffold(\n`;
    guidance += `  body: SafeArea(\n`;
    guidance += `    child: Column(\n`;
    guidance += `      children: [\n`;
    const widgetNames = childWidgetNames(analysis.children);
    widgetNames.forEach(widgetName => {
        guidance += `        ${widgetName}(),\n`;
    });
    guidance += `      ],\n`;
    guidance += `    ),\n`;
    guidance += `  ),\n`;
    guidance += `)\n\n`;

    // Child widgets guidance
    if (analysis.children.length > 0) {
        guidance += `Child widgets:\n`;
        analysis.children.forEach((child, index) => {
            guidance += `${index + 1}. ${widgetNames[index]}()\n`;
            guidance += `   Elements: ${child.children.length} child layers\n`;
            if (child.components.length > 0) {
                guidance += `   Components: ${child.components.length} nested components\n`;
            }
        });
        guidance += `\n`;
    }

    return guidance;
}

// Helper functions
/** Layers Figma marks scrollBehavior FIXED (they stay put when the parent scrolls), named with their node id. */
function formatFixedOnScroll(children: Array<{name: string; type: string; nodeId: string; scrollBehavior?: string}>): string {
    const fixed = children.filter(child => child.scrollBehavior === 'FIXED');
    if (fixed.length === 0) return '';
    return `Fixed on scroll (Figma scrollBehavior: FIXED):\n${fixed.map(child => `- ${child.name} (${child.type}, ${child.nodeId})\n`).join('')}\n`;
}

/** One valid, distinct Dart class name per child: a letter first, and a count suffix when a name repeats. */
function childWidgetNames(children: Array<{name: string}>): string[] {
    const used = new Set<string>();
    return children.map(child => {
        const typed = typeName(child.name);
        const base = /^[A-Za-z]/.test(typed) ? typed : `W${typed}`;
        let name = base;
        for (let count = 2; used.has(name); count++) name = `${base}${count}`;
        used.add(name);
        return name;
    });
}
