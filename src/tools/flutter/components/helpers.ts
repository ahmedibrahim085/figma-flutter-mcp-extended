import {dartColor} from "../../../utils/dart-color.js";
import {formatFills} from "../../../utils/paint-format.js";
import {FlutterCodeGenerator, indentContinuation} from "../../../extractors/flutter/style-library.js";
import {WIDGET_SPLIT_ADVICE} from "../../../utils/flutter-guidance.js";
import type {ComponentAnalysis} from "../../../extractors/components/types.js";
import {generateFlutterTextWidget, convertFillToColorInfo} from "../../../extractors/components/extractor.js";
import {generateComponentVisualContext} from "../visual-context.js";
import {formatComponentProperties} from "../../../utils/component-properties.js";
import {formatInteractions, formatNestedInteractions} from "../../../utils/interactions.js";
import {formatCategorizedEffects} from "../../../utils/effects-format.js";
import {filterEffectivelyVisibleChildren, isEffectivelyVisible} from "../../../utils/visibility.js";
import {formatPadding, formatStrokes, formatSizingAlignment} from "../../../utils/style-format.js";
import {generateFigmaUrl} from "../../../utils/figma-url-parser.js";

/**
 * Generate comprehensive component analysis report
 */
export function generateComponentAnalysisReport(
    analysis: ComponentAnalysis,
    parsedInput?: any
): string {
    let output = `Component Analysis Report\n\n`;

    // Component metadata
    output += `Component: ${analysis.metadata.name}\n`;
    output += `Type: ${analysis.metadata.type}\n`;
    output += `Node ID: ${analysis.metadata.nodeId}\n`;
    if (parsedInput) {
        output += `Source: ${parsedInput.source === 'url' ? 'Figma URL' : 'Direct input'}\n`;
    }
    output += `\n`;
    output += formatComponentProperties(analysis.metadata.componentProperties);
    output += formatInteractions(analysis.metadata.interactions, '');

    // Layout information
    output += `Layout Structure:\n`;
    output += `- Type: ${analysis.layout.type}\n`;
    output += analysis.layout.boundsMissing
        ? `- Dimensions: not set by Figma\n`
        : `- Dimensions: ${Math.round(analysis.layout.dimensions.width)}×${Math.round(analysis.layout.dimensions.height)}px\n`;
    if (analysis.layout.grid) {
        const {rows, columns, rowGap, columnGap} = analysis.layout.grid;
        const counts = [rows !== undefined && `${rows} rows`, columns !== undefined && `${columns} columns`].filter(Boolean).join(' × ');
        const parts = [counts, rowGap !== undefined && `row gap ${rowGap}`, columnGap !== undefined && `column gap ${columnGap}`].filter(Boolean);
        output += `- layoutMode: ${analysis.layout.layoutMode}${parts.length ? ` (${parts.join(', ')})` : ''}\n`;
    }

    if (analysis.layout.direction) {
        output += `- Direction: ${analysis.layout.direction}\n`;
    }
    if (analysis.layout.spacing !== undefined) {
        output += `- Spacing: ${analysis.layout.spacing}px\n`;
    }
    output += formatPadding(analysis.layout.padding);
    output += formatSizingAlignment({
        horizontal: analysis.layout.sizingHorizontal,
        vertical: analysis.layout.sizingVertical,
        align: analysis.layout.layoutAlign
    }, '- ');
    if (analysis.layout.mainAxisAlignment) {
        output += `- Main Axis Alignment: ${analysis.layout.mainAxisAlignment}\n`;
    }
    if (analysis.layout.crossAxisAlignment) {
        output += `- Cross Axis Alignment: ${analysis.layout.crossAxisAlignment}\n`;
    }
    output += `\n`;

    // Styling information
    output += `Visual Styling:\n`;
    if (analysis.styling.fills && analysis.styling.fills.length > 0) {
        output += formatFills(analysis.styling.fills);
    }
    output += formatStrokes(analysis.styling.strokes);
    if (analysis.styling.cornerRadius !== undefined) {
        if (typeof analysis.styling.cornerRadius === 'number') {
            output += `- Corner radius: ${analysis.styling.cornerRadius}px\n`;
        } else {
            const r = analysis.styling.cornerRadius;
            output += `- Corner radius: ${r.topLeft}px ${r.topRight}px ${r.bottomRight}px ${r.bottomLeft}px\n`;
        }
    }
    if (analysis.styling.opacity && analysis.styling.opacity !== 1) {
        output += `- Opacity: ${Math.round(analysis.styling.opacity * 100)}%\n`;
    }

    // Effects (shadows, blurs) — from node.effects via categorizeEffects
    output += formatCategorizedEffects(analysis.styling.effects);
    output += `\n`;

    // Children information
    if (analysis.children.length > 0) {
        output += `Child layers (${analysis.children.length} analyzed):\n`;
        analysis.children.forEach((child, index) => {
            const componentMark = child.isNestedComponent ? ' [COMPONENT]' : '';
            output += `${index + 1}. ${child.name} (${child.type})${componentMark}\n`;
            output += formatInteractions(child.interactions, '   ');
            output += formatNestedInteractions(child.children, '   ');

            if (child.basicInfo?.layout?.boundsMissing) {
                output += `   Size: not set by Figma\n`;
            } else if (child.basicInfo?.layout?.dimensions) {
                const dims = child.basicInfo.layout.dimensions;
                output += `   Size: ${Math.round(dims.width)}×${Math.round(dims.height)}px\n`;
            }
            output += formatSizingAlignment({
                horizontal: child.basicInfo?.layout?.sizingHorizontal,
                vertical: child.basicInfo?.layout?.sizingVertical,
                align: child.basicInfo?.layout?.layoutAlign
            }, '   ');
            output += formatPadding(child.basicInfo?.layout?.padding, '   ', '');

            if (child.basicInfo?.styling?.fills && child.basicInfo.styling.fills.length > 0) {
                output += formatFills(child.basicInfo.styling.fills, '   ', '');
            }
            output += formatStrokes(child.basicInfo?.styling?.strokes, '   ', undefined, '');
            if (child.basicInfo?.styling?.cornerRadius !== undefined) {
                const radius = child.basicInfo.styling.cornerRadius;
                if (typeof radius === 'number') {
                    output += `   Corner radius: ${radius}px\n`;
                }
            }

            if (child.basicInfo?.text) {
                const textInfo = child.basicInfo.text;
                output += `   Text Content: "${textInfo.content}"\n`;

                if (textInfo.fontFamily || textInfo.fontSize || textInfo.fontWeight) {
                    const fontParts = [];
                    if (textInfo.fontFamily) fontParts.push(textInfo.fontFamily);
                    if (textInfo.fontSize) fontParts.push(`${textInfo.fontSize}px`);
                    if (textInfo.fontWeight) fontParts.push(`weight: ${textInfo.fontWeight}`);
                    output += `   Typography: ${fontParts.join(' ')}\n`;
                }

                if (textInfo.textCase && textInfo.textCase !== 'mixed') {
                    output += `   Text Case: ${textInfo.textCase}\n`;
                }
            }
        });
        output += `\n`;
    }

    // Nested components for separate analysis
    if (analysis.nestedComponents.length > 0) {
        output += `Nested Components Found (${analysis.nestedComponents.length}):\n`;
        output += `These components should be analyzed separately to maintain reusability:\n`;
        analysis.nestedComponents.forEach((comp, index) => {
            output += `${index + 1}. ${comp.name}\n`;
            output += `   Node ID: ${comp.nodeId}\n`;
            output += `   Type: ${comp.instanceType}\n`;
            if (comp.componentKey) {
                output += `   Component Key: ${comp.componentKey}\n`;
            }
        });
        output += `\n`;
    }

    // Skipped nodes report
    if (analysis.skippedNodes && analysis.skippedNodes.length > 0) {
        output += `Analysis Limitations:\n`;
        output += `${analysis.skippedNodes.length} nodes were skipped due to the maxChildNodes limit:\n`;
        analysis.skippedNodes.forEach((skipped, index) => {
            output += `${index + 1}. ${skipped.name} (${skipped.type})\n`;
        });
        output += `\nTo analyze all nodes, increase the maxChildNodes parameter.\n\n`;
    }

    // Visual context for AI implementation
    if (parsedInput?.source === 'url') {
        // Reconstruct the Figma URL from the parsed input
        const figmaUrl = generateFigmaUrl(parsedInput.fileId, parsedInput.nodeId);
        output += generateComponentVisualContext(analysis, figmaUrl, parsedInput.nodeId);
        output += `\n`;
    }

    // Flutter implementation guidance
    output += generateFlutterGuidance(analysis);

    return output;
}

/**
 * Generate Flutter implementation guidance
 */
export function generateFlutterGuidance(analysis: ComponentAnalysis): string {
    let guidance = `Flutter Implementation Guidance:\n\n`;

    // Widget composition best practices
    guidance += `🏗️  Widget Composition Best Practices:\n`;
    WIDGET_SPLIT_ADVICE.forEach(line => { guidance += `- ${line}\n`; });
    guidance += `\n`;

    // Main container guidance
    guidance += `Main Widget Structure:\n`;
    if (analysis.layout.type === 'auto-layout') {
        const containerWidget = analysis.layout.direction === 'horizontal' ? 'Row' : 'Column';
        guidance += `- Use ${containerWidget}() as the main layout widget\n`;

        if (analysis.layout.spacing && analysis.layout.spacing > 0) {
            const spacingWidget = analysis.layout.direction === 'horizontal' ? 'width' : 'height';
            guidance += `- Add spacing with SizedBox(${spacingWidget}: ${analysis.layout.spacing})\n`;
        }

        const crossAxisAlignment =
            analysis.layout.crossAxisAlignment ?? analysis.layout.justifyContent;
        if (crossAxisAlignment) {
            guidance += `- CrossAxisAlignment: ${mapFigmaToFlutterAlignment(crossAxisAlignment, 'cross')}\n`;
        }
        const mainAxisAlignment =
            analysis.layout.mainAxisAlignment ?? analysis.layout.alignItems;
        if (mainAxisAlignment) {
            guidance += `- MainAxisAlignment: ${mapFigmaToFlutterAlignment(mainAxisAlignment, 'main')}\n`;
        }
    } else {
        guidance += `- Use Container() or Stack() for layout\n`;
    }

    // Styling guidance
    if (hasVisualStyling(analysis.styling)) {
        guidance += `\nContainer Decoration:\n`;
        guidance += `Container(\n`;
        guidance += `  decoration: BoxDecoration(\n`;

        if (analysis.styling.fills && analysis.styling.fills.length > 0) {
            const color = dartColor(analysis.styling.fills[0]);
            if (color) {
                guidance += `    color: ${color},\n`;
            }
        }

        if (analysis.styling.strokes && analysis.styling.strokes.length > 0) {
            const stroke = analysis.styling.strokes[0];
            const side = (width: number | undefined) =>
                `BorderSide(color: ${dartColor(stroke)}${width === undefined ? '' : `, width: ${width}`})`;
            if (stroke.individualWeights) {
                const w = stroke.individualWeights;
                guidance += `    border: Border(\n      top: ${side(w.top)},\n      right: ${side(w.right)},\n      bottom: ${side(w.bottom)},\n      left: ${side(w.left)},\n    ),\n`;
            } else if (stroke.weight === undefined) {
                guidance += `    border: Border.all(\n      color: ${dartColor(stroke)},\n      // width: strokeWeight not set by Figma\n    ),\n`;
            } else {
                guidance += `    border: Border.all(\n      color: ${dartColor(stroke)},\n      width: ${stroke.weight},\n    ),\n`;
            }
        }

        if (analysis.styling.cornerRadius !== undefined) {
            if (typeof analysis.styling.cornerRadius === 'number') {
                guidance += `    borderRadius: BorderRadius.circular(${analysis.styling.cornerRadius}),\n`;
            } else {
                const r = analysis.styling.cornerRadius;
                guidance += `    borderRadius: BorderRadius.only(\n`;
                guidance += `      topLeft: Radius.circular(${r.topLeft}),\n`;
                guidance += `      topRight: Radius.circular(${r.topRight}),\n`;
                guidance += `      bottomLeft: Radius.circular(${r.bottomLeft}),\n`;
                guidance += `      bottomRight: Radius.circular(${r.bottomRight}),\n`;
                guidance += `    ),\n`;
            }
        }

        if (analysis.styling.effects?.dropShadows.length) {
            guidance += `    boxShadow: [\n`;
            analysis.styling.effects.dropShadows.forEach(shadow => {
                guidance += `      BoxShadow(\n`;
                guidance += `        color: ${dartColor({color: shadow.color})},\n`;
                guidance += shadow.offset
                    ? `        offset: Offset(${shadow.offset.x}, ${shadow.offset.y}),\n`
                    : `        // offset: not set by Figma\n`;
                guidance += `        blurRadius: ${shadow.radius},\n`;
                if (shadow.spread) {
                    guidance += `        spreadRadius: ${shadow.spread},\n`;
                }
                guidance += `      ),\n`;
            });
            guidance += `    ],\n`;
        }

        guidance += `  ),\n`;

        if (analysis.layout.padding) {
            const p = analysis.layout.padding;
            if (p.isUniform) {
                guidance += `  padding: EdgeInsets.all(${p.top}),\n`;
            } else {
                guidance += `  padding: EdgeInsets.fromLTRB(${p.left}, ${p.top}, ${p.right}, ${p.bottom}),\n`;
            }
        }

        // Fills after the first are layers; the last is drawn on top (Figma order).
        const layers = FlutterCodeGenerator.generateFillLayers({fills: analysis.styling.fills, cornerRadius: analysis.styling.cornerRadius});
        guidance += `  child: ${layers.length > 0 ? indentContinuation(FlutterCodeGenerator.nestFillLayers(layers, '/* Your content here */'), 2) + ',' : '/* Your content here */'}\n`;
        guidance += `)\n\n`;
    }

    // Component organization guidance
    if (analysis.nestedComponents.length > 0) {
        guidance += `Component Architecture:\n`;
        guidance += `Create separate widget classes for reusability:\n`;
        analysis.nestedComponents.forEach((comp, index) => {
            const widgetName = toPascalCase(comp.name);
            guidance += `${index + 1}. ${widgetName}() - Node ID: ${comp.nodeId}\n`;
        });
        guidance += `\nAnalyze each nested component separately using the analyze_figma_component tool.\n\n`;
    }

    // Text widget guidance with enhanced Flutter suggestions
    const textChildren = analysis.children.filter(child => child.type === 'TEXT');
    if (textChildren.length > 0) {
        guidance += `Text Elements & Flutter Widgets:\n`;
        textChildren.forEach((textChild, index) => {
            const textInfo = textChild.basicInfo?.text;
            if (textInfo) {
                // Import the generateFlutterTextWidget function result
                const widgetSuggestion = generateFlutterTextWidget(textInfo);
                guidance += `${index + 1}. "${textInfo.content}"\n`;
                guidance += `   Flutter Widget:\n`;

                // Indent the widget suggestion
                const indentedWidget = widgetSuggestion.split('\n').map(line => `   ${line}`).join('\n');
                guidance += `${indentedWidget}\n\n`;
            } else {
                guidance += `${index + 1}. // TEXT layer "${textChild.name}" (${textChild.nodeId}): characters not read\n\n`;
            }
        });
    }

    return guidance;
}

/**
 * Generate structure inspection report
 */
export function generateStructureInspectionReport(node: any, showAllChildren: boolean): string {
    let output = `Component Structure Inspection\n\n`;

    output += `Component: ${node.name}\n`;
    output += `Type: ${node.type}\n`;
    output += `Node ID: ${node.id}\n`;
    output += `Children: ${node.children?.length || 0}\n`;

    if (node.absoluteBoundingBox) {
        const bbox = node.absoluteBoundingBox;
        output += `Dimensions: ${Math.round(bbox.width)}×${Math.round(bbox.height)}px\n`;
    }
    output += formatSizingAlignment({
        horizontal: node.layoutSizingHorizontal,
        vertical: node.layoutSizingVertical,
        align: node.layoutAlign
    });

    output += `\n`;

    if (!node.children || node.children.length === 0) {
        output += `This component has no children.\n`;
        return output;
    }

    const childrenSource = showAllChildren
        ? node.children
        : filterEffectivelyVisibleChildren(node.children, false);
    const hiddenSkipped = (node.children?.length || 0) - childrenSource.length;

    output += `Child Structure:\n`;

    const childrenToShow = showAllChildren ? childrenSource : childrenSource.slice(0, 15);
    const hasMore = childrenSource.length > childrenToShow.length;

    childrenToShow.forEach((child: any, index: number) => {
        const isComponent = child.type === 'COMPONENT' || child.type === 'INSTANCE';
        const componentMark = isComponent ? ' [COMPONENT]' : '';
        const hiddenMark = child.visible === false ? ' [HIDDEN]' : '';
        const emptySlotMark =
            child.visible !== false && !isEffectivelyVisible(child)
                ? ' [EMPTY_HIDDEN_SLOT]'
                : '';

        output += `${index + 1}. ${child.name} (${child.type})${componentMark}${hiddenMark}${emptySlotMark}\n`;

        if (child.absoluteBoundingBox) {
            const bbox = child.absoluteBoundingBox;
            output += `   Size: ${Math.round(bbox.width)}×${Math.round(bbox.height)}px\n`;
        }
        output += formatSizingAlignment({
            horizontal: child.layoutSizingHorizontal,
            vertical: child.layoutSizingVertical,
            align: child.layoutAlign
        }, '   ');

        if (child.children && child.children.length > 0) {
            output += `   Contains: ${child.children.length} child nodes\n`;
        }

        // Show basic styling info
        output += formatFills((child.fills ?? []).filter((fill: any) => fill.visible !== false && fill.color).map(convertFillToColorInfo), '   ', '');
    });

    if (hasMore) {
        output += `\n... and ${childrenSource.length - childrenToShow.length} more children.\n`;
        output += `Use showAllChildren: true to see all children.\n`;
    }

    if (!showAllChildren && hiddenSkipped > 0) {
        output += `\nSkipped ${hiddenSkipped} hidden / empty-slot child(ren). Use showAllChildren: true to include them.\n`;
    }

    // Analysis recommendations
    output += `\nAnalysis Recommendations:\n`;
    const componentChildren = childrenSource.filter((child: any) =>
        child.type === 'COMPONENT' || child.type === 'INSTANCE'
    );

    if (componentChildren.length > 0) {
        output += `- Found ${componentChildren.length} nested components for separate analysis\n`;
    }

    const textChildren = node.children.filter((child: any) => child.type === 'TEXT');
    if (textChildren.length > 0) {
        output += `- Found ${textChildren.length} text nodes for content extraction\n`;
    }

    return output;
}

// Helper functions
/**
 * Maps a Figma auto-layout alignment to the Flutter enum for that axis. One
 * shared map used to hand `CrossAxisAlignment.*` to the main axis as well.
 */
export function mapFigmaToFlutterAlignment(alignment: string, axis: 'main' | 'cross'): string {
    const alignmentMap: Record<string, string> = axis === 'main'
        ? {
            'MIN': 'MainAxisAlignment.start',
            'CENTER': 'MainAxisAlignment.center',
            'MAX': 'MainAxisAlignment.end',
            'SPACE_BETWEEN': 'MainAxisAlignment.spaceBetween',
            'SPACE_AROUND': 'MainAxisAlignment.spaceAround',
            'SPACE_EVENLY': 'MainAxisAlignment.spaceEvenly'
        }
        : {
            'MIN': 'CrossAxisAlignment.start',
            'CENTER': 'CrossAxisAlignment.center',
            'MAX': 'CrossAxisAlignment.end',
            'BASELINE': 'CrossAxisAlignment.baseline'
        };

    // Unknown values fall back to start: Figma's default alignment is MIN.
    return alignmentMap[alignment] || (axis === 'main' ? 'MainAxisAlignment.start' : 'CrossAxisAlignment.start');
}

export function hasVisualStyling(styling: any): boolean {
    return !!(styling.fills?.length || styling.strokes?.length ||
        styling.cornerRadius !== undefined || styling.effects?.dropShadows?.length);
}

export function toPascalCase(str: string): string {
    return str
        .replace(/[^a-zA-Z0-9]/g, ' ')
        .replace(/\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .replace(/\s/g, '');
}
