// src/tools/flutter/components/deduplicated-helpers.mts

import { MAX_CHILD_DEPTH, NESTED_COMPONENT_TYPES, type DeduplicatedComponentAnalysis, type DeduplicatedComponentChild } from '../../../extractors/components/deduplicated-extractor.js';
import { FlutterStyleLibrary } from '../../../extractors/flutter/style-library.js';
import { dartString, indentTail, textWidgetCode } from '../../../extractors/flutter/text-style.js';
import { generateComponentVisualContext } from '../visual-context.js';
import type { ComponentAnalysis, LayoutInfo } from '../../../extractors/components/types.js';
import { formatComponentProperties } from '../../../utils/component-properties.js';
import { formatInteractions } from '../../../utils/interactions.js';
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
      output += `${index + 1}. ${child.name} (${child.type})\n`;
      
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
    rootProps.push(`child: ${indentTail(overflowLayout(layout, analysis.layout, analysis.children, analysis.metadata.name, approximations), 2)},`);
  }
  let root = hugLimits(box('Container', rootProps), analysis.layout);
  // A FILL axis's max sits between the LimitedBox and the infinite Container (research 06 P16: 400 bounded, 360 unbounded).
  const fillAxes = (['width', 'height'] as const).filter(axis => analysis.layout[SIZING_KEY[axis]] === 'FILL');
  root = constrained(boxConstraints(analysis.layout, fillAxes), root);
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
 * The widget for a frame's children: a frame without auto layout is a Stack of children placed by their constraints;
 * auto layout with an ABSOLUTE child is a Stack around the padded flow (see positioned); otherwise a Row/Column.
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
  if (!paddingInsideStack(frame, children)) return flexWidget(children, frame, name, styleLibrary, approximations);
  const absoluteAt = children.map(child => child.layout.positioning === 'ABSOLUTE');
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
  // itemReverseZIndex: "the first layer will be drawn on top", so the whole paint order reverses.
  if (frame.reverseZIndex) [behind, front] = [front.reverse(), behind.reverse()];
  let flex = flexWidget(flow, frame, name, styleLibrary, approximations);
  if (padding) flex = box('Padding', [`padding: ${padding},`, `child: ${indentTail(flex, 2)},`]);
  return clipStack([...behind, flex, ...front], ['fit: StackFit.passthrough,'], frame);
}

/** Auto layout with an ABSOLUTE child: it renders as a Stack, and the frame's padding moves inside that Stack. */
function paddingInsideStack(frame: LayoutInfo, children: DeduplicatedComponentChild[] | undefined): boolean {
  return !!frame.direction && !!children?.some(child => child.layout.positioning === 'ABSOLUTE');
}

/** A Stack of `items` clipped like the Figma frame: Clip.none without clipsContent, ClipRRect when the frame is rounded. */
function clipStack(items: string[], args: string[], frame: LayoutInfo): string {
  const clip = frame.clipsContent ? [] : ['clipBehavior: Clip.none,'];
  const stack = multiChild('Stack', [...args, ...clip], items.map(item => `${indentAll(item, 4)},\n`).join(''));
  const radius = frame.clipsContent ? borderRadius(frame.cornerRadius) : '';
  return radius ? box('ClipRRect', [`borderRadius: ${radius},`, `child: ${indentTail(stack, 2)},`]) : stack;
}

/** A widget with arguments and a `children:` list whose items are already indented and comma-terminated. */
function multiChild(name: string, args: string[], items: string): string {
  return `${name}(\n${args.map(arg => `  ${arg}\n`).join('')}  children: [\n${items}  ],\n)`;
}

/** Dart BorderRadius for a Figma radius (one number, or [topLeft, topRight, bottomRight, bottomLeft]); '' when none. */
function borderRadius(radius: number | number[] | undefined): string {
  if (typeof radius === 'number') return radius > 0 ? `BorderRadius.circular(${dartNumber(radius)})` : '';
  if (!radius?.some(corner => corner > 0)) return '';
  const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
    .map((corner, i) => radius[i] > 0 ? `${corner}: Radius.circular(${dartNumber(radius[i])})` : '').filter(Boolean);
  return `BorderRadius.only(${corners.join(', ')})`;
}

/** A number for generated Dart: at most 4 decimals, no trailing zeros. */
const dartNumber = (value: number) => String(Math.round(value * 10000) / 10000 || 0);

const MIN_KEY = {width: 'minWidth', height: 'minHeight'} as const;
const MAX_KEY = {width: 'maxWidth', height: 'maxHeight'} as const;
const SIZING_KEY = {width: 'sizingHorizontal', height: 'sizingVertical'} as const;

/** `BoxConstraints(minWidth: …, maxWidth: …)` for the given axes' Figma min/max, or '' when none is set. */
function boxConstraints(layout: LayoutInfo, axes: ('width' | 'height')[]): string {
  const parts = axes.flatMap(axis => [MIN_KEY[axis], MAX_KEY[axis]])
    .filter(key => layout[key] !== undefined).map(key => `${key}: ${dartNumber(layout[key]!)}`);
  return parts.length ? `BoxConstraints(${parts.join(', ')})` : '';
}

/** `child` in a ConstrainedBox, or unchanged when there is nothing to constrain. */
function constrained(constraints: string, child: string): string {
  return constraints ? box('ConstrainedBox', [`constraints: ${constraints},`, `child: ${indentTail(child, 2)},`]) : child;
}

/**
 * A HUG node's min/max become a ConstrainedBox (on a FIXED axis they change nothing, research 06 P14). When a HUG main
 * axis is clamped by its max and its children add up to more, overflowLayout keeps the children at their size and clips.
 */
function hugLimits(widget: string, layout: LayoutInfo): string {
  const axes = (['width', 'height'] as const).filter(axis => layout[SIZING_KEY[axis]] === 'HUG');
  return constrained(boxConstraints(layout, axes), widget);
}

/** Whether a HUG main axis is clamped by its max (measured = max) with children adding up to more. */
function overflowsMax(layout: LayoutInfo, children: DeduplicatedComponentChild[] | undefined): boolean {
  if (!layout.direction || !children?.length) return false;
  const axis = layout.direction === 'horizontal' ? 'width' : 'height';
  const max = layout[MAX_KEY[axis]];
  if (layout[SIZING_KEY[axis]] !== 'HUG' || max === undefined) return false;
  if (Math.round(layout.dimensions[axis]) !== Math.round(max)) return false;
  const padding = layout.padding ? (axis === 'width' ? layout.padding.left + layout.padding.right : layout.padding.top + layout.padding.bottom) : 0;
  const extent = children.reduce((sum, child) => sum + child.layout.dimensions[axis], 0) + Math.max(0, layout.spacing ?? 0) * (children.length - 1) + padding;
  return extent > max;
}

/**
 * The Row/Column in an UnconstrainedBox when its frame is clamped by a max narrower than its children: they keep their
 * size and are clipped like Figma's clipsContent. (Research 06's OverflowBox recipe needs OverflowBoxFit, which
 * material.dart does not export; this one measured 100 wide, children at 0, 0 errors in bounded, scroll and Row hosts.)
 * It always clips: with Clip.none it throws "RenderConstraintsTransformBox overflowed" (ticket 06 Standards review), so a
 * frame that shows its overflow in Figma is named as an approximation instead.
 */
function overflowLayout(layout: string, frame: LayoutInfo, children: DeduplicatedComponentChild[] | undefined, name: string, approximations: string[]): string {
  if (!overflowsMax(frame, children)) return layout;
  const widget = box('UnconstrainedBox', [
    `constrainedAxis: ${frame.direction === 'horizontal' ? 'Axis.vertical' : 'Axis.horizontal'},`,
    'alignment: Alignment.topLeft,',
    'clipBehavior: Clip.hardEdge,',
    `child: ${indentTail(layout, 2)},`,
  ]);
  const axis = frame.direction === 'horizontal' ? 'width' : 'height';
  return frame.clipsContent ? widget
    : approximate(`"${name}" shows its children past its max ${axis} in Figma; they are clipped here`, widget, approximations);
}

/**
 * A child of a Stack frame placed by its Figma constraints (research 05 table, measured against Figma's resize rule).
 * Start/end/stretch axes are Positioned edges and sizes. CENTER and SCALE axes are placed inside the Positioned box:
 * CENTER shifts a frame-sized box by its offset from the centre (left: s, right: -s), SCALE spans the frame; then
 * Align > FractionallySizedBox (SCALE) > SizedBox (CENTER size; infinite on a stretch axis, which Align would loosen).
 */
function positioned(child: DeduplicatedComponentChild, frame: LayoutInfo, styleLibrary: FlutterStyleLibrary, approximations: string[]): string {
  const origin = child.layout.origin ?? {x: 0, y: 0};
  const frameOrigin = frame.origin ?? {x: 0, y: 0};
  const axes = [
    {constraint: child.layout.constraints?.horizontal ?? 'LEFT', offset: origin.x - frameOrigin.x, size: child.layout.dimensions.width,
      frameSize: frame.dimensions.width, start: 'left', end: 'right', name: 'width'},
    {constraint: child.layout.constraints?.vertical ?? 'TOP', offset: origin.y - frameOrigin.y, size: child.layout.dimensions.height,
      frameSize: frame.dimensions.height, start: 'top', end: 'bottom', name: 'height'},
  ];
  const wrapped = axes.some(axis => axis.constraint === 'CENTER' || axis.constraint === 'SCALE');
  const edges: Record<string, number> = {};
  const sizes: Record<string, number> = {};
  const align: number[] = [];
  const factors: string[] = [];
  const boxSizes: string[] = [];
  for (const {constraint, offset, size, frameSize, start, end, name} of axes) {
    let alignment = -1;
    if (constraint === 'RIGHT' || constraint === 'BOTTOM') {
      edges[end] = frameSize - offset - size;
      sizes[name] = size;
    } else if (constraint === 'LEFT_RIGHT' || constraint === 'TOP_BOTTOM') {
      edges[start] = offset;
      edges[end] = frameSize - offset - size;
      if (wrapped) boxSizes.push(`${name}: double.infinity,`);
    } else if (constraint === 'CENTER') {
      const shift = offset + size / 2 - frameSize / 2;
      edges[start] = shift;
      edges[end] = -shift;
      alignment = 0;
      boxSizes.push(`${name}: ${dartNumber(size)},`);
    } else if (constraint === 'SCALE') {
      edges[start] = 0;
      edges[end] = 0;
      alignment = size === frameSize ? -1 : 2 * offset / (frameSize - size) - 1;
      factors.push(`${name}Factor: ${dartNumber(size / frameSize)},`);
    } else {
      // LEFT / TOP, and the fallback when REST omits constraints.
      edges[start] = offset;
      sizes[name] = size;
    }
    align.push(alignment);
  }
  let code = childWidget(child, styleLibrary, approximations) ?? sizedBox([]);
  if (boxSizes.length) code = box('SizedBox', [...boxSizes, `child: ${indentTail(code, 2)},`]);
  if (factors.length) code = box('FractionallySizedBox', [...factors, `child: ${indentTail(code, 2)},`]);
  if (wrapped) code = box('Align', [`alignment: Alignment(${align.map(dartNumber).join(', ')}),`, `child: ${indentTail(code, 2)},`]);
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

/**
 * The Row or Column for a frame's `children`, each rendered by childWidget: a HUG main axis shrinks to them, auto-layout
 * alignment maps to Flutter, and the item gap becomes SizedBox gaps between rendered children (none under SPACE_*).
 * REST omits MIN alignment, so a missing value is MIN.
 */
function flexWidget(
  children: DeduplicatedComponentChild[],
  frame: LayoutInfo,
  name: string,
  styleLibrary: FlutterStyleLibrary,
  approximations: string[]
): string {
  const axis = frame.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const mainSize = axis === 'horizontal' ? 'width' : 'height';
  const mainKey = SIZING_KEY[mainSize];
  const crossKey = SIZING_KEY[axis === 'horizontal' ? 'height' : 'width'];
  const mainAxisSizing = frame[mainKey];
  const args: string[] = [];
  const notes: string[] = [];
  if (mainAxisSizing === 'HUG') args.push('mainAxisSize: MainAxisSize.min,');
  const primary = frame.mainAxisAlignment ?? 'MIN';
  let gap = 0;
  if (frame.direction) {
    // A HUG main axis leaves no free space, so main-axis alignment has no visible effect (in Figma or in Flutter) — unless
    // a min makes the frame wider than its children (research 06 G6: a centred child sits at x=30).
    if (mainAxisSizing !== 'HUG' || frame[MIN_KEY[mainSize]] !== undefined) {
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
  // Min/max on main-axis FILL children (research 06, owner decisions 2026-10-01): a single FILL child with a max is
  // Flexible > ConstrainedBox > infinite SizedBox (exact at every width); among several FILL siblings, one clamped by its
  // min/max keeps its Figma size (exact at the design width); a min alone is ignored by Expanded.
  const fillCount = rendered.filter(child => child.layout[mainKey] === 'FILL').length;
  const flexibleMax = new Set<DeduplicatedComponentChild>();
  const clamped = rendered.map(child => {
    const layout = child.layout;
    if (layout[mainKey] !== 'FILL') return child;
    const min = layout[MIN_KEY[mainSize]];
    const max = layout[MAX_KEY[mainSize]];
    const measured = Math.round(layout.dimensions[mainSize]);
    const binds = (limit: number | undefined) => limit !== undefined && measured === Math.round(limit);
    if (fillCount > 1 && (binds(max) || binds(min))) {
      notes.push(`"${child.name}" is clamped beside other FILL siblings; it keeps its Figma ${mainSize} ${measured}`);
      return {...child, layout: {...layout, [mainKey]: 'FIXED' as const}};
    }
    if (max !== undefined) flexibleMax.add(child);
    else if (min !== undefined) notes.push(`"${child.name}" has a min ${mainSize} of ${dartNumber(min)}; it can shrink below it when the parent is narrower`);
    return child;
  });
  const items = clamped
    .map(child => {
      const code = childWidget(child, styleLibrary, approximations);
      if (!code) return code;
      const filled = fillCrossAxis(code, child.layout, axis);
      return flexibleMax.has(child)
        ? box('Flexible', [`child: ${indentTail(constrained(boxConstraints(child.layout, [mainSize]),
          box('SizedBox', [`${mainSize}: double.infinity,`, `child: ${indentTail(filled, 2)},`])), 2)},`])
        : wrapForMainAxisSizing(filled, child.layout, axis);
    })
    .map(code => code && `${indentAll(code, 4)},\n`)
    .filter(Boolean)
    .join(gap ? `    SizedBox(${axis === 'horizontal' ? 'width' : 'height'}: ${gap}),\n` : '');
  const comments = notes.map(note => approximate(note, '', approximations)).join('');
  let flex = multiChild(axis === 'horizontal' ? 'Row' : 'Column', args, items);
  // A cross-axis FILL child needs a bounded cross axis: a HUG one is bounded by the tallest (widest) sibling, as in Figma.
  if (frame[crossKey] === 'HUG' && clamped.some(child => child.layout[crossKey] === 'FILL')) {
    flex = box(axis === 'horizontal' ? 'IntrinsicHeight' : 'IntrinsicWidth', [`child: ${indentTail(flex, 2)},`]);
  }
  return `${comments}${flex}`;
}

/**
 * A cross-axis FILL child fills its parent's cross axis; per child, so FIXED siblings keep their size (unlike stretch).
 * A cross-axis max goes outside the infinite box (research 06 P15: 40; swapped, the max is lost: 100).
 */
function fillCrossAxis(code: string, layout: LayoutInfo, axis: 'horizontal' | 'vertical'): string {
  const crossSize = axis === 'horizontal' ? 'height' : 'width';
  if (layout[SIZING_KEY[crossSize]] !== 'FILL') return code;
  const fill = box('SizedBox', [`${crossSize}: double.infinity,`, `child: ${indentTail(code, 2)},`]);
  return constrained(boxConstraints(layout, [crossSize]), fill);
}

/** An approximation: a comment at the widget, and a line in the tool output's Approximations list. */
function approximate(note: string, widget: string, approximations: string[]): string {
  // Layer names can hold line breaks; one would end the Dart line comment early.
  const line = note.replace(/[\r\n]+/g, ' ');
  approximations.push(line);
  return `// approximate: ${line}\n${widget}`;
}

/** Dart for one analysed child: text, shape, frame (recursively) or a nested-component placeholder. */
function childWidget(child: DeduplicatedComponentChild, styleLibrary: FlutterStyleLibrary, approximations: string[]): string | undefined {
  const styleOf = (category: string) => child.styleRefs.find(id => styleLibrary.getStyle(id)?.category === category);
  if (child.type === 'TEXT') {
    if (!child.textContent) return undefined;
    const textStyleId = styleOf('text');
    // Only an explicit FIXED width is emitted: a text node sizes itself by textAutoResize otherwise.
    const width = child.layout.sizingHorizontal === 'FIXED' ? Math.round(child.layout.dimensions.width) : undefined;
    return hugLimits(textWidgetCode(child.textWidget ?? {text: child.textContent}, textStyleId ? styleLibrary.getStyle(textStyleId)!.flutterCode : undefined, width), child.layout);
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
    const layout = overflowLayout(layoutWidget(child.children, child.layout, child.name, styleLibrary, approximations,
      paddingInside ? styleOf('padding') : undefined), child.layout, child.children, child.name, approximations);
    // A Container holding only a child adds nothing (avoid_unnecessary_containers); a HUG min/max still applies.
    if (props.length === 0) return hugLimits(layout, child.layout);
    props.push(`child: ${indentTail(layout, 2)},`);
    // Nothing drawn: a SizedBox holds the size and the child (sized_box_for_whitespace).
    widget = box(decoration || padding ? 'Container' : 'SizedBox', props);
  } else {
    widget = decoration || padding ? box('Container', props) : sizedBox(props);
  }
  widget = hugLimits(widget, child.layout);
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
  output += formatInteractions(analysis.metadata.interactions, '');

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
      output += `   ${index + 1}. ${child.name} (${child.type})\n`;
      output += formatInteractions(child.interactions, '      ');
      
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
          fontFamily: undefined,
          fontSize: undefined,
          fontWeight: undefined,
          textCase: 'mixed' as const
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
