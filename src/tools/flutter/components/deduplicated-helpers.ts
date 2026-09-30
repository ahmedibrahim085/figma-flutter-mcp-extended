// src/tools/flutter/components/deduplicated-helpers.mts

import { MAX_CHILD_DEPTH, NESTED_COMPONENT_TYPES, type DeduplicatedComponentAnalysis, type DeduplicatedComponentChild } from '../../../extractors/components/deduplicated-extractor.js';
import { FlutterStyleLibrary } from '../../../extractors/flutter/style-library.js';
import { dartString, indentTail, textWidgetCode } from '../../../extractors/flutter/text-style.js';
import { generateComponentVisualContext } from '../visual-context.js';
import type { ComponentAnalysis, LayoutInfo } from '../../../extractors/components/types.js';
import { formatComponentProperties } from '../../../utils/component-properties.js';
import { formatSizingAlignment } from '../../../utils/style-format.js';

export function generateDeduplicatedReport(analysis: DeduplicatedComponentAnalysis): string {
  let output = `Component Analysis (Deduplicated)\n\n`;
  
  output += `Component: ${analysis.metadata.name}\n`;
  output += `Type: ${analysis.metadata.type}\n`;
  output += `Node ID: ${analysis.metadata.nodeId}\n\n`;
  
  // Style references
  if (Object.keys(analysis.styleRefs).length > 0) {
    output += `Style References:\n`;
    Object.entries(analysis.styleRefs).forEach(([category, styleId]) => {
      output += `- ${category}: ${styleId}\n`;
    });
    output += `\n`;
  }
  
  // Children with their style references
  if (analysis.children.length > 0) {
    output += `Children (${analysis.children.length}):\n`;
    analysis.children.forEach((child, index) => {
      const semanticMark = child.semanticType ? ` [${child.semanticType.toUpperCase()}]` : '';
      output += `${index + 1}. ${child.name} (${child.type})${semanticMark}\n`;
      
      if (child.textContent) {
        output += `   Text: "${child.textContent}"\n`;
      }
      
      if (child.styleRefs.length > 0) {
        output += `   Styles: ${child.styleRefs.join(', ')}\n`;
      }
    });
    output += `\n`;
  }
  
  // New style definitions (only show if this analysis created new styles)
  if (analysis.newStyleDefinitions && Object.keys(analysis.newStyleDefinitions).length > 0) {
    output += `New Style Definitions:\n`;
    Object.entries(analysis.newStyleDefinitions).forEach(([id, definition]) => {
      output += `${id}: ${definition.category} style\n`;
    });
    output += `\nUse generate_flutter_implementation tool for complete Flutter code.\n`;
  }
  
  return output;
}

/** Indent every line of `code` by `spaces`, including the first line. */
function indentAll(code: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return code.split('\n').map(line => pad + line).join('\n');
}

/**
 * Wrap a child widget in Expanded when the Figma auto-layout sizing on the
 * container's main axis is FILL — the child is meant to stretch to fill the
 * remaining space, not keep its measured Figma dimension.
 */
function wrapForMainAxisSizing(
  widgetCode: string,
  childLayout: {sizingHorizontal?: string; sizingVertical?: string} | undefined,
  direction: 'horizontal' | 'vertical'
): string {
  const mainAxisSizing = direction === 'horizontal' ? childLayout?.sizingHorizontal : childLayout?.sizingVertical;
  if (mainAxisSizing !== 'FILL') {
    return widgetCode;
  }
  return `Expanded(\n  child: ${indentTail(widgetCode, 2)},\n)`;
}

export function generateFlutterImplementation(analysis: DeduplicatedComponentAnalysis): string {
  const styleLibrary = FlutterStyleLibrary.getInstance();
  let implementation = `Flutter Implementation:\n\n`;
  
  // Widget composition guidance
  implementation += `🏗️  Widget Composition Guidelines:\n`;
  implementation += `- Build the complete widget tree inline in build() method first\n`;
  implementation += `- Keep composing until you reach ~200 lines, then extract private widgets\n`;
  implementation += `- Use private StatelessWidget classes (prefix with _) for breakdown\n`;
  implementation += `- Avoid functional widgets - always use proper StatelessWidget classes\n\n`;
  
  // Widget structure
  const widgetName = toPascalCase(analysis.metadata.name);
  implementation += `class ${widgetName} extends StatelessWidget {\n`;
  implementation += `  const ${widgetName}({Key? key}) : super(key: key);\n\n`;
  implementation += `  @override\n`;
  implementation += `  Widget build(BuildContext context) {\n`;
  implementation += `    return Container(\n`;
  implementation += fixedSizeProps(analysis.layout).map(prop => `      ${prop}\n`).join('');
  
  // Apply decoration if exists
  if (analysis.styleRefs.decoration) {
    implementation += `      decoration: ${analysis.styleRefs.decoration},\n`;
  }
  
  // Apply padding if exists
  if (analysis.styleRefs.padding) {
    implementation += `      padding: ${analysis.styleRefs.padding},\n`;
  }
  
  // Add child widget structure
  const approximations: string[] = [];
  if (analysis.children.length > 0) {
    const layout = layoutWidget(analysis.children, analysis.layout, styleLibrary, approximations);
    implementation += `      child: ${indentTail(layout, 6)},\n`;
  }
  
  implementation += `    );\n`;
  implementation += `  }\n`;
  implementation += `}\n`;
  if (approximations.length > 0) {
    implementation += `\n⚠️ Approximations:\n${approximations.map(note => `- ${note}\n`).join('')}`;
  }
  
  return implementation;
}

/** Shapes whose outline a BoxDecoration cannot draw; they render as their bounding box. */
const BOUNDING_BOX_TYPES = new Set(['LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION']);

/**
 * Pixel sizes for the axes Figma sizes as FIXED. HUG and FILL axes carry none (upstream #35).
 * Nodes outside auto layout have no sizing in the REST response and keep their measured size.
 */
function fixedSizeProps(layout: LayoutInfo): string[] {
  const props: string[] = [];
  if (layout.sizingHorizontal !== 'HUG' && layout.sizingHorizontal !== 'FILL' && layout.dimensions.width > 0) {
    props.push(`width: ${Math.round(layout.dimensions.width)},`);
  }
  if (layout.sizingVertical !== 'HUG' && layout.sizingVertical !== 'FILL' && layout.dimensions.height > 0) {
    props.push(`height: ${Math.round(layout.dimensions.height)},`);
  }
  return props;
}

/** The Row or Column for a frame's `children`, each rendered by childWidget; a HUG main axis shrinks to them. */
function layoutWidget(
  children: DeduplicatedComponentChild[],
  frame: LayoutInfo,
  styleLibrary: FlutterStyleLibrary,
  approximations: string[]
): string {
  const axis = frame.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const mainAxisSizing = axis === 'horizontal' ? frame.sizingHorizontal : frame.sizingVertical;
  const items = children.map(child => {
    const code = childWidget(child, styleLibrary, approximations);
    return code ? `${indentAll(wrapForMainAxisSizing(code, child.layout, axis), 4)},\n` : '';
  }).join('');
  const mainAxisSize = mainAxisSizing === 'HUG' ? '  mainAxisSize: MainAxisSize.min,\n' : '';
  return `${axis === 'horizontal' ? 'Row' : 'Column'}(\n${mainAxisSize}  children: [\n${items}  ],\n)`;
}

/** An approximation: a comment at the widget, and a line in the tool output's Approximations list. */
function approximate(note: string, widget: string, approximations: string[]): string {
  // Layer names can hold line breaks; one would end the Dart line comment early.
  const line = note.replace(/[\r\n]+/g, ' ');
  approximations.push(line);
  return `// approximate: ${line}\n${widget}`;
}

/** Dart for one analysed child: text, button, shape, frame (recursively) or a nested-component placeholder. */
function childWidget(child: DeduplicatedComponentChild, styleLibrary: FlutterStyleLibrary, approximations: string[]): string | undefined {
  if (child.semanticType === 'button' && child.textContent) {
    return `ElevatedButton(\n  onPressed: () {},\n  child: Text(${dartString((child.textWidget ?? {text: child.textContent}).text)}),\n)`;
  }
  const styleOf = (category: string) => child.styleRefs.find(id => styleLibrary.getStyle(id)?.category === category);
  if (child.type === 'TEXT') {
    if (!child.textContent) return undefined;
    const textStyleId = styleOf('text');
    return textWidgetCode(child.textWidget ?? {text: child.textContent}, textStyleId ? styleLibrary.getStyle(textStyleId)!.flutterCode : undefined);
  }
  // A placeholder stands in for content that is not rendered, so it keeps the measured size except on a FILL axis.
  const w = child.layout.sizingHorizontal === 'FILL' ? undefined : Math.round(child.layout.dimensions.width);
  const h = child.layout.sizingVertical === 'FILL' ? undefined : Math.round(child.layout.dimensions.height);
  const placeholderSize = [w === undefined ? '' : `width: ${w},`, h === undefined ? '' : `height: ${h},`].filter(Boolean);
  const placeholder = sizedBox(placeholderSize);
  if (NESTED_COMPONENT_TYPES.has(child.type)) {
    return approximate(`component "${child.name}" is not inlined; analyze it separately`, placeholder, approximations);
  }
  const decoration = styleOf('decoration');
  if (child.truncated) {
    const widget = decoration ? box('Container', [...placeholderSize, `decoration: ${decoration},`]) : placeholder;
    return approximate(`"${child.name}" is deeper than ${MAX_CHILD_DEPTH} levels; its children are not rendered`, widget, approximations);
  }
  const props = fixedSizeProps(child.layout);
  if (decoration) props.push(`decoration: ${decoration},`);
  const padding = styleOf('padding');
  if (padding) props.push(`padding: ${padding},`);
  let widget: string;
  if (child.children?.length) {
    const layout = layoutWidget(child.children, child.layout, styleLibrary, approximations);
    // A Container holding only a child adds nothing (avoid_unnecessary_containers).
    if (props.length === 0) return layout;
    props.push(`child: ${indentTail(layout, 2)},`);
    // Nothing drawn: a SizedBox holds the size and the child (sized_box_for_whitespace).
    widget = box(decoration || padding ? 'Container' : 'SizedBox', props);
  } else {
    widget = decoration || padding ? box('Container', props) : sizedBox(props);
  }
  if (BOUNDING_BOX_TYPES.has(child.type)) {
    return approximate(`"${child.name}" (${child.type}) is drawn as its bounding box`, widget, approximations);
  }
  return widget;
}

/** A multi-line widget call, one property per line. */
function box(name: string, props: string[]): string {
  return `${name}(\n${props.map(prop => `  ${prop}\n`).join('')})`;
}

/** A one-line SizedBox holding only its size, e.g. `SizedBox(width: 7, height: 7)`. */
function sizedBox(sizeProps: string[]): string {
  return `SizedBox(${sizeProps.map(prop => prop.replace(/,$/, '')).join(', ')})`;
}

/**
 * Generate comprehensive deduplicated report with style library statistics
 */
export function generateComprehensiveDeduplicatedReport(
  analysis: DeduplicatedComponentAnalysis,
  includeStyleStats: boolean = true
): string {
  let output = `📊 Comprehensive Component Analysis (Deduplicated)\n`;
  output += `${'='.repeat(60)}\n\n`;

  // Component metadata
  output += `🏷️  Component Metadata:\n`;
  output += `   • Name: ${analysis.metadata.name}\n`;
  output += `   • Type: ${analysis.metadata.type}\n`;
  output += `   • Node ID: ${analysis.metadata.nodeId}\n`;
  output += `   • Size: ${Math.round(analysis.layout.dimensions.width)}×${Math.round(analysis.layout.dimensions.height)}px\n`;
  output += formatSizingAlignment({
    horizontal: analysis.layout.sizingHorizontal,
    vertical: analysis.layout.sizingVertical,
    align: analysis.layout.layoutAlign
  }, '   • ', {horizontal: 'Horizontal sizing', vertical: 'Vertical sizing', align: 'Parent alignment'});
  if (analysis.metadata.componentKey) {
    output += `   • Component Key: ${analysis.metadata.componentKey}\n`;
  }
  output += `\n`;
  output += formatComponentProperties(analysis.metadata.componentProperties);

  // Style references with usage information
  if (Object.keys(analysis.styleRefs).length > 0) {
    output += `🎨 Style References (Deduplicated):\n`;
    const styleLibrary = FlutterStyleLibrary.getInstance();
    
    Object.entries(analysis.styleRefs).forEach(([category, styleId]) => {
      const style = styleLibrary.getStyle(styleId);
      if (style) {
        output += `   • ${category}: ${styleId} (used ${style.usageCount} times)\n`;
      } else {
        output += `   • ${category}: ${styleId} (style not found)\n`;
      }
    });
    output += `\n`;
  } else {
    output += `🎨 Style References: None detected\n\n`;
  }

  // Children analysis with enhanced details
  if (analysis.children.length > 0) {
    output += `👶 Children Analysis (${analysis.children.length} children):\n`;
    analysis.children.forEach((child, index) => {
      const semanticMark = child.semanticType ? ` [${child.semanticType.toUpperCase()}]` : '';
      output += `   ${index + 1}. ${child.name} (${child.type})${semanticMark}\n`;
      
      if (child.textContent) {
        output += `      📝 Text: "${child.textContent}"\n`;
      }

      output += `      📐 Size: ${Math.round(child.layout.dimensions.width)}×${Math.round(child.layout.dimensions.height)}px\n`;
      output += formatSizingAlignment({
        horizontal: child.layout.sizingHorizontal,
        vertical: child.layout.sizingVertical,
        align: child.layout.layoutAlign
      }, '      📐 ', {horizontal: 'Horizontal sizing', vertical: 'Vertical sizing', align: 'Parent alignment'});
      
      if (child.styleRefs.length > 0) {
        output += `      🎨 Style refs: ${child.styleRefs.join(', ')}\n`;
      }
      
      if (child.semanticType) {
        output += `      🏷️  Semantic type: ${child.semanticType}\n`;
      }
    });
    output += `\n`;
  } else {
    output += `👶 Children: No children detected\n\n`;
  }

  // Nested components
  if (analysis.nestedComponents.length > 0) {
    output += `🔗 Nested Components (${analysis.nestedComponents.length}):\n`;
    analysis.nestedComponents.forEach((nested, index) => {
      output += `   ${index + 1}. ${nested.name}\n`;
      output += `      🆔 Node ID: ${nested.nodeId}\n`;
      if (nested.componentKey) {
        output += `      🔑 Component Key: ${nested.componentKey}\n`;
      }
      output += `      🔧 Needs separate analysis: ${nested.needsSeparateAnalysis ? 'Yes' : 'No'}\n`;
    });
    output += `\n`;
  }

  // New style definitions created in this analysis
  if (analysis.newStyleDefinitions && Object.keys(analysis.newStyleDefinitions).length > 0) {
    output += `✨ New Style Definitions Created:\n`;
    Object.entries(analysis.newStyleDefinitions).forEach(([id, definition]) => {
      output += `   • ${id} (${definition.category})\n`;
      output += `     Usage count: ${definition.usageCount}\n`;
      output += `     Properties: ${Object.keys(definition.properties).join(', ')}\n`;
    });
    output += `\n`;
  }

  // Style library statistics (if requested)
  if (includeStyleStats) {
    const styleLibrary = FlutterStyleLibrary.getInstance();
    const allStyles = styleLibrary.getAllStyles();
    
    output += `📚 Style Library Summary:\n`;
    output += `   • Total unique styles: ${allStyles.length}\n`;
    
    if (allStyles.length > 0) {
      const categoryStats = allStyles.reduce((acc, style) => {
        acc[style.category] = (acc[style.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      Object.entries(categoryStats).forEach(([category, count]) => {
        output += `   • ${category}: ${count} style(s)\n`;
      });
      
      const totalUsage = allStyles.reduce((sum, style) => sum + style.usageCount, 0);
      output += `   • Total style usage: ${totalUsage}\n`;
      
      if (totalUsage > allStyles.length) {
        const efficiency = ((totalUsage - allStyles.length) / totalUsage * 100).toFixed(1);
        output += `   • Deduplication efficiency: ${efficiency}% reduction\n`;
      }
    }
    output += `\n`;
  }

  // Quick actions
  output += `🚀 Quick Actions:\n`;
  output += `   • Use 'generate_flutter_implementation' tool for complete Flutter code\n`;
  output += `   • Use 'analyze_figma_component' with different components to build style library\n`;
  output += `   • Use 'resetStyleLibrary: true' to start fresh analysis\n\n`;
  
  output += `🏗️  Widget Composition Reminder:\n`;
  output += `   • Build complete widget tree inline first (~200 lines max)\n`;
  output += `   • Extract to private StatelessWidget classes only when needed\n`;
  output += `   • Avoid functional widgets - use proper StatelessWidget classes\n`;

  return output;
}

/**
 * Add visual context to comprehensive deduplicated report
 */
export function addVisualContextToDeduplicatedReport(
  analysis: DeduplicatedComponentAnalysis,
  figmaUrl?: string,
  nodeId?: string
): string {
  // Convert deduplicated analysis to component analysis format for visual context
  const componentAnalysis: ComponentAnalysis = {
    metadata: analysis.metadata,
    layout: analysis.layout,
    styling: {
      fills: [],
      strokes: [],
      cornerRadius: undefined,
      opacity: 1,
      effects: { dropShadows: [], innerShadows: [], blurs: [] }
    },
    children: analysis.children.map((child, index) => ({
      name: child.name,
      type: child.type,
      nodeId: `node_${index}`,
      isNestedComponent: false,
      visualImportance: 5,
      basicInfo: {
        layout: child.layout,
        styling: { 
          fills: [], 
          strokes: [], 
          opacity: 1,
          effects: { dropShadows: [], innerShadows: [], blurs: [] }
        },
        text: child.textContent ? {
          content: child.textContent,
          isPlaceholder: false,
          fontFamily: undefined,
          fontSize: undefined,
          fontWeight: undefined,
          textCase: 'mixed' as const,
          semanticType: (child.semanticType === 'button' || child.semanticType === 'link' || 
                       child.semanticType === 'heading' || child.semanticType === 'body' ||
                       child.semanticType === 'label' || child.semanticType === 'caption' ||
                       child.semanticType === 'error' || child.semanticType === 'success' ||
                       child.semanticType === 'warning') ? child.semanticType : 'other' as const
        } : undefined
      }
    })),
    nestedComponents: analysis.nestedComponents,
    skippedNodes: []
  };

  return generateComponentVisualContext(componentAnalysis, figmaUrl, nodeId);
}

/**
 * Generate style library status report
 */
export function generateStyleLibraryReport(): string {
  const styleLibrary = FlutterStyleLibrary.getInstance();
  const allStyles = styleLibrary.getAllStyles();
  
  let output = `📚 Style Library Status Report\n`;
  output += `${'='.repeat(40)}\n\n`;

  if (allStyles.length === 0) {
    output += `⚠️  Style library is empty.\n`;
    output += `   • Analyze components with 'useDeduplication: true' to populate\n`;
    output += `   • Use 'analyze_figma_component' tool to start building your style library\n`;
    return output;
  }

  output += `📊 Library Statistics:\n`;
  output += `   • Total unique styles: ${allStyles.length}\n`;
  
  // Show optimization info
  const hierarchy = styleLibrary.getStyleHierarchy();
  const hierarchyCount = Object.keys(hierarchy).filter(id => 
    hierarchy[id].parentId || hierarchy[id].childIds.length > 0
  ).length;
  
  if (hierarchyCount > 0) {
    output += `   • Styles with relationships: ${hierarchyCount}\n`;
  }
  
  // Category breakdown
  const categoryStats = allStyles.reduce((acc, style) => {
    acc[style.category] = (acc[style.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  output += `   • Style categories:\n`;
  Object.entries(categoryStats).forEach(([category, count]) => {
    output += `     - ${category}: ${count} style(s)\n`;
  });

  // Usage statistics
  const totalUsage = allStyles.reduce((sum, style) => sum + style.usageCount, 0);
  output += `   • Total style usage: ${totalUsage}\n`;
  
  if (totalUsage > allStyles.length) {
    const efficiency = ((totalUsage - allStyles.length) / totalUsage * 100).toFixed(1);
    output += `   • Deduplication efficiency: ${efficiency}% reduction\n`;
  }

  // Most used styles
  const sortedByUsage = [...allStyles].sort((a, b) => b.usageCount - a.usageCount);
  const topStyles = sortedByUsage.slice(0, 5);
  
  if (topStyles.length > 0) {
    output += `\n🔥 Most Used Styles:\n`;
    topStyles.forEach((style, index) => {
      output += `   ${index + 1}. ${style.id} (${style.category}) - used ${style.usageCount} times\n`;
    });
  }

  // Detailed style list
  output += `\n📋 All Styles:\n`;
  Object.entries(categoryStats).forEach(([category, count]) => {
    const categoryStyles = allStyles.filter(s => s.category === category);
    output += `\n   ${category.toUpperCase()} (${count}):\n`;
    categoryStyles.forEach(style => {
      output += `   • ${style.id} (used ${style.usageCount} times)\n`;
    });
  });

  return output;
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .replace(/\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .replace(/\s/g, '');
}
