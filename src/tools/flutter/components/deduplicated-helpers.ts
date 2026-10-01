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
  // A FILL axis on the root fills its host (double.infinity); in an unbounded host (a scroll view, a Row) a LimitedBox caps it
  // at the Figma size instead of letting it throw. Without a measured size there is nothing to cap at, so the axis asks for
  // no size at all: an uncapped double.infinity throws in an unbounded host.
  const rootProps: string[] = [];
  const limits: string[] = [];
  const {width, height} = analysis.layout.dimensions;
  for (const [name, sizing, size, limit] of [['width', analysis.layout.sizingHorizontal, width, 'maxWidth'], ['height', analysis.layout.sizingVertical, height, 'maxHeight']] as const) {
    if (sizing !== 'FILL') {
      const fixed = axisSize(name, sizing, size);
      if (fixed) rootProps.push(fixed);
    } else if (size > 0) {
      rootProps.push(`${name}: double.infinity,`);
      limits.push(`${limit}: ${Math.round(size)},`);
    }
  }
  if (analysis.styleRefs.decoration) rootProps.push(`decoration: ${analysis.styleRefs.decoration},`);
  const rootPaddingInside = paddingInsideStack(analysis.layout, analysis.children);
  if (analysis.styleRefs.padding && !rootPaddingInside) rootProps.push(`padding: ${analysis.styleRefs.padding},`);
  const approximations: string[] = [];
  if (analysis.children.length > 0) {
    const layout = layoutWidget(analysis.children, analysis.layout, analysis.metadata.name, styleLibrary, approximations,
      rootPaddingInside ? analysis.styleRefs.padding : undefined);
    rootProps.push(`child: ${indentTail(layout, 2)},`);
  }
  let root = box('Container', rootProps);
  if (limits.length > 0) root = box('LimitedBox', [...limits, `child: ${indentTail(root, 2)},`]);
  implementation += `    return ${indentTail(root, 4)};\n`;
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
  return [axisSize('width', layout.sizingHorizontal, layout.dimensions.width), axisSize('height', layout.sizingVertical, layout.dimensions.height)]
    .filter(Boolean);
}

/** One axis's size property: rounded pixels unless the axis is HUG or FILL or has no measured size; '' when none. */
function axisSize(name: 'width' | 'height', sizing: string | undefined, size: number): string {
  return sizing !== 'HUG' && sizing !== 'FILL' && size > 0 ? `${name}: ${Math.round(size)},` : '';
}

/** Figma primaryAxisAlignItems → MainAxisAlignment; MIN is Flutter's default start, so it emits nothing. */
const MAIN_AXIS_ALIGNMENT: Record<string, string | undefined> = {
  MIN: undefined, CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'spaceBetween', SPACE_AROUND: 'spaceAround', SPACE_EVENLY: 'spaceEvenly',
};
/** Figma counterAxisAlignItems → CrossAxisAlignment; Flutter's default is center, so CENTER emits nothing and MIN emits start. */
const CROSS_AXIS_ALIGNMENT: Record<string, string | undefined> = {MIN: 'start', CENTER: undefined, MAX: 'end', BASELINE: 'baseline'};

/**
 * The Row or Column for a frame's `children`, each rendered by childWidget: a HUG main axis shrinks to them, auto-layout
 * alignment maps to Flutter, and the item gap becomes SizedBox gaps between rendered children (none under SPACE_*).
 * REST omits MIN alignment, so a missing value is MIN.
 */
function layoutWidget(
  children: DeduplicatedComponentChild[],
  frame: LayoutInfo,
  name: string,
  styleLibrary: FlutterStyleLibrary,
  approximations: string[],
  padding?: string
): string {
  // A frame without auto layout places every child by its constraints; groups lend their layers to it (Figma applies
  // constraints to a group's layers, relative to the frame).
  if (!frame.direction) {
    const layers = children.flatMap(function lift(child): DeduplicatedComponentChild[] {
      return child.type === 'GROUP' && child.children?.length ? child.children.flatMap(lift) : [child];
    });
    return clipStack(layers.map(layer => positioned(layer, frame, styleLibrary, approximations)), [], frame);
  }
  const absoluteAt = children.map(child => child.layout.positioning === 'ABSOLUTE');
  if (!absoluteAt.includes(true)) return flexWidget(children, frame, name, styleLibrary, approximations);
  // ABSOLUTE children leave the flow: the flow Row/Column sizes a Stack (StackFit.passthrough keeps its constraints), the
  // padding moves inside so positions are measured from the frame's outer box, and z-order follows the layer list.
  const first = absoluteAt.indexOf(false);
  const last = absoluteAt.lastIndexOf(false);
  const flow = children.filter((_, i) => !absoluteAt[i]);
  let behind: string[] = [];
  let front: string[] = [];
  children.forEach((child, i) => {
    if (!absoluteAt[i]) return;
    const layer = positioned(child, frame, styleLibrary, approximations);
    if (i < first) behind.push(layer);
    else if (i > last) front.push(layer);
    else front.push(approximate(`"${child.name}" is absolute between flow children of "${name}"; it is painted in front of them`, layer, approximations));
  });
  if (frame.reverseZIndex) [behind, front] = [front, behind];
  let flex = flexWidget(flow, frame, name, styleLibrary, approximations);
  if (padding) flex = box('Padding', [`padding: ${padding},`, `child: ${indentTail(flex, 2)},`]);
  return clipStack([...behind, flex, ...front], ['fit: StackFit.passthrough,'], frame);
}

/** Whether a frame's padding moves inside its Stack: auto layout with an ABSOLUTE child. */
function paddingInsideStack(frame: LayoutInfo, children: DeduplicatedComponentChild[] | undefined): boolean {
  return !!frame.direction && !!children?.some(child => child.layout.positioning === 'ABSOLUTE');
}

/** A Stack of `items` clipped like the Figma frame: Clip.none without clipsContent, ClipRRect when the frame is rounded. */
function clipStack(items: string[], args: string[], frame: LayoutInfo): string {
  const clip = frame.clipsContent ? [] : ['clipBehavior: Clip.none,'];
  const stack = `Stack(\n${[...args, ...clip].map(arg => `  ${arg}\n`).join('')}  children: [\n${items.map(item => `${indentAll(item, 4)},\n`).join('')}  ],\n)`;
  return frame.clipsContent && frame.cornerRadius
    ? box('ClipRRect', [`borderRadius: BorderRadius.circular(${frame.cornerRadius}),`, `child: ${indentTail(stack, 2)},`])
    : stack;
}

/** A number for generated Dart: at most 4 decimals, no trailing zeros. */
const dartNumber = (value: number) => String(Math.round(value * 10000) / 10000);

/**
 * A child of a Stack frame placed by its Figma constraints (research 05 table, 29 probes matching Figma's resize rule).
 * Start/end/stretch axes are Positioned edges and sizes; CENTER and SCALE axes span the frame and are placed inside it:
 * Padding (CENTER offset) > Align > FractionallySizedBox (SCALE) > SizedBox (CENTER size) > child.
 */
function positioned(child: DeduplicatedComponentChild, frame: LayoutInfo, styleLibrary: FlutterStyleLibrary, approximations: string[]): string {
  const origin = child.layout.origin ?? {x: 0, y: 0};
  const frameOrigin = frame.origin ?? {x: 0, y: 0};
  const edges: Record<string, number> = {};
  const sizes: Record<string, number> = {};
  const padding: Record<string, number> = {};
  const factors: string[] = [];
  const boxSizes: string[] = [];
  const align = {x: -1, y: -1};
  let wrapped = false;
  const axis = (constraint: string, offset: number, size: number, frameSize: number, start: string, end: string, sizeName: 'width' | 'height', key: 'x' | 'y') => {
    if (constraint === 'RIGHT' || constraint === 'BOTTOM') {
      edges[end] = frameSize - offset - size;
      sizes[sizeName] = size;
    } else if (constraint === 'LEFT_RIGHT' || constraint === 'TOP_BOTTOM') {
      edges[start] = offset;
      edges[end] = frameSize - offset - size;
    } else if (constraint === 'CENTER') {
      wrapped = true;
      edges[start] = 0;
      edges[end] = 0;
      const shift = offset + size / 2 - frameSize / 2;
      if (shift > 0) padding[start] = 2 * shift;
      if (shift < 0) padding[end] = -2 * shift;
      align[key] = 0;
      boxSizes.push(`${sizeName}: ${dartNumber(size)},`);
    } else if (constraint === 'SCALE') {
      wrapped = true;
      edges[start] = 0;
      edges[end] = 0;
      align[key] = size === frameSize ? -1 : 2 * offset / (frameSize - size) - 1;
      factors.push(`${sizeName}Factor: ${dartNumber(size / frameSize)},`);
    } else {
      // LEFT / TOP, and the fallback when REST omits constraints.
      edges[start] = offset;
      sizes[sizeName] = size;
    }
  };
  const {width, height} = child.layout.dimensions;
  axis(child.layout.constraints?.horizontal ?? 'LEFT', origin.x - frameOrigin.x, width, frame.dimensions.width, 'left', 'right', 'width', 'x');
  axis(child.layout.constraints?.vertical ?? 'TOP', origin.y - frameOrigin.y, height, frame.dimensions.height, 'top', 'bottom', 'height', 'y');
  let code = childWidget(child, styleLibrary, approximations) ?? sizedBox([]);
  if (boxSizes.length) code = box('SizedBox', [...boxSizes, `child: ${indentTail(code, 2)},`]);
  if (factors.length) code = box('FractionallySizedBox', [...factors, `child: ${indentTail(code, 2)},`]);
  if (wrapped) code = box('Align', [`alignment: Alignment(${dartNumber(align.x)}, ${dartNumber(align.y)}),`, `child: ${indentTail(code, 2)},`]);
  if (Object.keys(padding).length) {
    const insets = ['left', 'top', 'right', 'bottom'].filter(side => side in padding).map(side => `${side}: ${dartNumber(padding[side])}`).join(', ');
    code = box('Padding', [`padding: EdgeInsets.only(${insets}),`, `child: ${indentTail(code, 2)},`]);
  }
  const props = [
    ...['left', 'right', 'top', 'bottom'].filter(edge => edge in edges).map(edge => `${edge}: ${dartNumber(edges[edge])},`),
    ...['width', 'height'].filter(size => size in sizes).map(size => `${size}: ${dartNumber(sizes[size])},`),
    `child: ${indentTail(code, 2)},`,
  ];
  const layer = box('Positioned', props);
  return child.layout.rotation
    ? approximate(`"${child.name}" is rotated; it is placed by its bounding box`, layer, approximations)
    : layer;
}

/** The Row or Column for an auto-layout frame's flow children (see layoutWidget). */
function flexWidget(
  children: DeduplicatedComponentChild[],
  frame: LayoutInfo,
  name: string,
  styleLibrary: FlutterStyleLibrary,
  approximations: string[]
): string {
  const axis = frame.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const mainKey = axis === 'horizontal' ? 'sizingHorizontal' : 'sizingVertical';
  const crossKey = axis === 'horizontal' ? 'sizingVertical' : 'sizingHorizontal';
  const mainAxisSizing = frame[mainKey];
  const args: string[] = [];
  const notes: string[] = [];
  if (mainAxisSizing === 'HUG') args.push('mainAxisSize: MainAxisSize.min,');
  const primary = frame.mainAxisAlignment ?? 'MIN';
  let gap = 0;
  if (frame.direction) {
    // A HUG main axis leaves no free space, so main-axis alignment has no visible effect (in Figma or in Flutter).
    if (mainAxisSizing !== 'HUG') {
      if (!(primary in MAIN_AXIS_ALIGNMENT)) notes.push(`"${name}" has primary-axis alignment ${primary}; start is used`);
      else if (MAIN_AXIS_ALIGNMENT[primary]) args.push(`mainAxisAlignment: MainAxisAlignment.${MAIN_AXIS_ALIGNMENT[primary]},`);
    }
    const counter = frame.crossAxisAlignment ?? 'MIN';
    if (!(counter in CROSS_AXIS_ALIGNMENT)) {
      notes.push(`"${name}" has counter-axis alignment ${counter}; center is used`);
    } else if (CROSS_AXIS_ALIGNMENT[counter]) {
      args.push(`crossAxisAlignment: CrossAxisAlignment.${CROSS_AXIS_ALIGNMENT[counter]},`);
      if (counter === 'BASELINE') {
        args.push('textBaseline: TextBaseline.alphabetic,');
        if (children.some(child => child.type !== 'TEXT')) notes.push(`"${name}" aligns to the text baseline; its non-text children sit at the top`);
      }
    }
    // Under SPACE_* Figma ignores the gap (a HUG frame's children touch); a negative gap overlaps, which both Flutter gap forms reject.
    const spacing = frame.spacing ?? 0;
    if (!primary.startsWith('SPACE_')) {
      if (spacing < 0) notes.push(`"${name}" has a negative gap (${spacing}); the overlap is not reproduced`);
      else gap = spacing;
    }
  }
  // A HUG main axis has no space to share: Figma keeps a FILL child at its own size, so it renders as FIXED there.
  const rendered = children.map(child => mainAxisSizing === 'HUG' && child.layout[mainKey] === 'FILL'
    ? {...child, layout: {...child.layout, [mainKey]: 'FIXED' as const}} : child);
  const items = rendered
    .map(child => childWidget(child, styleLibrary, approximations))
    .map((code, i) => code && `${indentAll(wrapForMainAxisSizing(fillCrossAxis(code, rendered[i].layout[crossKey], axis), rendered[i].layout, axis), 4)},\n`)
    .filter(Boolean)
    .join(gap ? `    SizedBox(${axis === 'horizontal' ? 'width' : 'height'}: ${gap}),\n` : '');
  const comments = notes.map(note => approximate(note, '', approximations)).join('');
  let flex = `${axis === 'horizontal' ? 'Row' : 'Column'}(\n${args.map(arg => `  ${arg}\n`).join('')}  children: [\n${items}  ],\n)`;
  // A cross-axis FILL child needs a bounded cross axis: a HUG one is bounded by the tallest (widest) sibling, as in Figma.
  if (frame[crossKey] === 'HUG' && rendered.some(child => child.layout[crossKey] === 'FILL')) {
    flex = box(axis === 'horizontal' ? 'IntrinsicHeight' : 'IntrinsicWidth', [`child: ${indentTail(flex, 2)},`]);
  }
  return `${comments}${flex}`;
}

/** A cross-axis FILL child fills its parent's cross axis; per child, so FIXED siblings keep their size (unlike stretch). */
function fillCrossAxis(code: string, crossSizing: string | undefined, axis: 'horizontal' | 'vertical'): string {
  if (crossSizing !== 'FILL') return code;
  return box('SizedBox', [`${axis === 'horizontal' ? 'height' : 'width'}: double.infinity,`, `child: ${indentTail(code, 2)},`]);
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
    // Only an explicit FIXED width is emitted: a text node sizes itself by textAutoResize otherwise.
    const width = child.layout.sizingHorizontal === 'FIXED' ? Math.round(child.layout.dimensions.width) : undefined;
    return textWidgetCode(child.textWidget ?? {text: child.textContent}, textStyleId ? styleLibrary.getStyle(textStyleId)!.flutterCode : undefined, width);
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
  const paddingInside = paddingInsideStack(child.layout, child.children);
  const padding = paddingInside ? undefined : styleOf('padding');
  if (padding) props.push(`padding: ${padding},`);
  let widget: string;
  if (child.children?.length) {
    const layout = layoutWidget(child.children, child.layout, child.name, styleLibrary, approximations,
      paddingInside ? styleOf('padding') : undefined);
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
