// src/extractors/flutter/text-style.ts

// The one place a text's Flutter TextStyle is written. Both component code paths
// (the deduplicated style library and the plain text-widget guidance) call it, so a
// text renders the same whichever path runs. Conversion rules: research 03b.

import type {FigmaFill, FigmaTextStyle} from '../../types/figma.js';

/** The Figma text properties the generated TextStyle is built from. */
export interface TextStyleFields {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  /** true emits FontStyle.italic; false (a run switching italic off) emits FontStyle.normal. */
  italic?: boolean;
  /** `#AARRGGBB` of the text's first fill, paint opacity included. */
  color?: string;
  /** Logical pixels (Figma REST gives px). */
  letterSpacing?: number;
  /** Line height as a multiple of fontSize, when Figma gives one. */
  height?: number;
  /** 'none' only for a run switching the base decoration off. */
  decoration?: 'underline' | 'lineThrough' | 'none';
  /** OpenType tags for small caps (INFERRED mapping, research 03b); [] for a run switching them off. */
  fontFeatures?: string[];
}

/** The Text-widget side of a text: the string as written and the fields TextStyle cannot hold. */
export interface TextWidgetFields {
  /** The string after Figma's letter case is applied. */
  text: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  maxLines?: number;
  /** True when maxLines was derived from the box height, not given by Figma. */
  maxLinesInferred?: boolean;
  ellipsis?: boolean;
  /** Truncated, but neither Figma nor the box gives a line count. */
  maxLinesUnknown?: boolean;
  /** Mixed-style runs, when the text has character style overrides: emitted as Text.rich. */
  runs?: TextRun[];
  /** Vertical alignment inside a fixed-height box (INFERRED rule): the box height and a Flutter `Alignment` name. */
  box?: {height: number; alignment: BoxAlignment};
  /** Paragraphs and the gap between them, when Figma sets paragraph spacing (INFERRED rule). */
  paragraphs?: {texts: string[]; spacing: number};
  /** Figma text properties with no Flutter equivalent, named in a comment. */
  notConverted?: string[];
}

/** Flutter `Alignment` constants a fixed-height text box can use (TOP needs no wrapper). */
export type BoxAlignment = 'center' | 'centerLeft' | 'centerRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight';

/** Consecutive characters that share one style override; `style` holds only what differs from the base. */
export interface TextRun {
  text: string;
  style?: TextStyleFields;
}

/** A text's character style overrides, as Figma REST sends them on the TEXT node. */
export interface TextOverrides {
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, Partial<FigmaTextStyle> & {fills?: FigmaFill[]}>;
  /** The node's first fill: the base color a run's own fill replaces. */
  baseFill?: FigmaFill;
}

/** `#AARRGGBB` of a solid fill: the color's alpha times the paint opacity. */
function argbHex(fill: FigmaFill): string | undefined {
  if (!fill.color) return undefined;
  const {r, g, b, a} = fill.color;
  const alpha = (a ?? 1) * (fill.opacity ?? 1);
  return `#${[alpha, r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * TextStyle fields from a Figma TypeStyle and the text's first fill.
 * Line height: PIXELS and Auto (INTRINSIC_%) are lineHeightPx / fontSize; FONT_SIZE_% is percent / 100.
 */
export function convertTypeStyle(style: FigmaTextStyle, fill?: FigmaFill): TextStyleFields {
  const {fontSize} = style;
  let height: number | undefined;
  if (style.lineHeightUnit === 'FONT_SIZE_%' && style.lineHeightPercentFontSize) {
    height = style.lineHeightPercentFontSize / 100;
  } else if (style.lineHeightPx && fontSize) {
    height = style.lineHeightPx / fontSize;
  }
  const decorations: Record<string, TextStyleFields['decoration']> = {UNDERLINE: 'underline', STRIKETHROUGH: 'lineThrough'};
  return {
    fontFamily: style.fontFamily,
    fontSize,
    fontWeight: style.fontWeight,
    italic: style.italic === true || undefined,
    color: fill ? argbHex(fill) : undefined,
    // Figma's default is 0; emitting it keeps Material 3's 0.25 from being inherited.
    letterSpacing: style.letterSpacing ?? 0,
    height: height === undefined ? undefined : Number(height.toFixed(4)),
    decoration: style.textDecoration ? decorations[style.textDecoration] : undefined,
    fontFeatures: style.textCase === 'SMALL_CAPS' ? ['smcp']
      : style.textCase === 'SMALL_CAPS_FORCED' ? ['smcp', 'c2sc'] : undefined,
  };
}

/**
 * Figma letter case, baked into the string: Flutter has no text-transform style.
 * `before` is the character preceding `text` (for a run inside a longer text), so TITLE
 * does not capitalise a run that starts mid-word.
 */
function applyTextCase(text: string, textCase?: string, before = ''): string {
  if (textCase === 'UPPER') return text.toUpperCase();
  if (textCase === 'LOWER') return text.toLowerCase();
  // A word starts after any character that is not a letter, digit or apostrophe.
  if (textCase === 'TITLE') {
    return (before + text).replace(/(^|[^\p{L}\p{N}'\u2019])(\p{L})/gu, (_, prev: string, first: string) => prev + first.toUpperCase()).slice(before.length);
  }
  return text;
}

/** What a run must emit to switch off a base field it does not have (a span otherwise inherits it). */
const SWITCHED_OFF: Partial<TextStyleFields> = {italic: false, decoration: 'none', fontFeatures: []};

/** The fields of `run` whose value differs from `base`; a field the run turns off becomes its explicit "off" value. */
function overriddenFields(run: TextStyleFields, base: TextStyleFields): TextStyleFields | undefined {
  const changed: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(run), ...Object.keys(base)]) as Set<keyof TextStyleFields>) {
    if (JSON.stringify(run[key]) === JSON.stringify(base[key])) continue;
    changed[key] = run[key] === undefined ? SWITCHED_OFF[key] : run[key];
  }
  const fields = Object.fromEntries(Object.entries(changed).filter(([, value]) => value !== undefined));
  return Object.keys(fields).length > 0 ? fields as TextStyleFields : undefined;
}

/**
 * Runs of consecutive characters that share an override id. Id 0, and indices past the
 * override array, use the base style (Figma REST TEXT node). Undefined when nothing is overridden.
 */
function textRuns(content: string, style: FigmaTextStyle, overrides: TextOverrides): TextRun[] | undefined {
  const ids = overrides.characterStyleOverrides ?? [];
  if (!content || !ids.some((id) => id !== 0)) return undefined;
  const idAt = (i: number) => ids[i] ?? 0;
  const base = convertTypeStyle(style, overrides.baseFill);
  const runs: TextRun[] = [];
  let start = 0;
  // Walk to one past the end so the last run is closed by the same test as every other.
  for (let i = 1; i <= content.length; i++) {
    const id = idAt(start);
    if (i < content.length && idAt(i) === id) continue;
    const entry = id === 0 ? undefined : overrides.styleOverrideTable?.[String(id)];
    const merged = {...style, ...entry} as FigmaTextStyle;
    runs.push({
      text: applyTextCase(content.slice(start, i), merged.textCase, content.slice(Math.max(0, start - 1), start)),
      style: entry ? overriddenFields(convertTypeStyle(merged, entry.fills?.[0] ?? overrides.baseFill), base) : undefined,
    });
    start = i;
  }
  return runs;
}

/**
 * Text-widget fields for a text node's content, TypeStyle and box height.
 * Ending truncation gives maxLines + ellipsis; with no maxLines from Figma the count is
 * floor(boxHeight / lineHeightPx), which research 03b marks as an inferred rule.
 */
export function convertTextWidget(content: string, style?: FigmaTextStyle, boxHeight?: number, overrides?: TextOverrides): TextWidgetFields {
  const widget: TextWidgetFields = {text: applyTextCase(content, style?.textCase)};
  // LEFT is explicit: Flutter's default `start` is right-aligned in RTL text.
  const aligns: Record<string, TextWidgetFields['textAlign']> = {LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify'};
  if (style?.textAlignHorizontal) widget.textAlign = aligns[style.textAlignHorizontal];
  const runs = style && overrides ? textRuns(content, style, overrides) : undefined;
  if (runs) widget.runs = runs;
  // Vertical alignment only matters when the box is taller than its text: a fixed-height box.
  const fixedHeight = style?.textAutoResize === 'NONE' || style?.textAutoResize === 'TRUNCATE';
  if (fixedHeight && boxHeight && (style.textAlignVertical === 'CENTER' || style.textAlignVertical === 'BOTTOM')) {
    const vertical = style.textAlignVertical === 'CENTER' ? 'center' : 'bottom';
    // Horizontal side from the textAlign already chosen above (JUSTIFIED sits on the left).
    const horizontal = widget.textAlign === 'center' ? 'Center' : widget.textAlign === 'right' ? 'Right' : 'Left';
    const alignment = (vertical === 'center' && horizontal === 'Center' ? 'center' : vertical + horizontal) as BoxAlignment;
    widget.box = {height: boxHeight, alignment};
  }
  if (style?.textTruncation === 'ENDING' || style?.textAutoResize === 'TRUNCATE') {
    widget.ellipsis = true;
    // Figma: maxLines applies only when textTruncation is ENDING.
    if (style.textTruncation === 'ENDING' && style.maxLines) {
      widget.maxLines = style.maxLines;
    } else if (boxHeight && style.lineHeightPx) {
      widget.maxLines = Math.max(1, Math.floor(boxHeight / style.lineHeightPx));
      widget.maxLinesInferred = true;
    } else {
      widget.maxLinesUnknown = true;
    }
  }
  const notConverted = [
    style?.paragraphIndent ? `paragraphIndent ${style.paragraphIndent}` : undefined,
    style?.listSpacing ? `listSpacing ${style.listSpacing}` : undefined,
    style?.leadingTrim && style.leadingTrim !== 'NONE' ? `leadingTrim ${style.leadingTrim}` : undefined,
  ].filter((item): item is string => item !== undefined);
  if (style?.paragraphSpacing && widget.text.includes('\n')) {
    // Separate Texts cannot share one line budget (each would get the box's maxLines and overflow),
    // and splitting would cut the spans of a Text.rich; both cases keep one Text and say so.
    if (runs) notConverted.push(`paragraphSpacing ${style.paragraphSpacing} (mixed-style runs)`);
    else if (widget.ellipsis) notConverted.push(`paragraphSpacing ${style.paragraphSpacing} (truncated text)`);
    else widget.paragraphs = {texts: widget.text.split('\n'), spacing: style.paragraphSpacing};
  }
  if (notConverted.length > 0) widget.notConverted = notConverted;
  return widget;
}

/** A single-quoted Dart string literal: `'`, `\`, `$` and newlines escaped. */
export function dartString(text: string): string {
  return `'${text.replace(/[\\'$]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')}'`;
}

/** Every line after the first indented by `spaces`, for nesting a multi-line widget. */
export function indentTail(code: string, spaces: number): string {
  return code.replace(/\n/g, `\n${' '.repeat(spaces)}`);
}

/**
 * Dart for `widget`, with `styleCode` as its style when given: a Text or Text.rich, split into
 * paragraphs and wrapped for vertical alignment when Figma asks for it.
 */
export function textWidgetCode(widget: TextWidgetFields, styleCode?: string): string {
  let code = widget.paragraphs ? paragraphsCode(widget, widget.paragraphs, styleCode) : singleTextCode(widget, widget.text, styleCode);
  if (widget.box) {
    code = `SizedBox(\n  height: ${widget.box.height},\n  child: Align(\n`
      + `    alignment: Alignment.${widget.box.alignment}, // inferred: vertical alignment inside the fixed-height box\n`
      + `    child: ${indentTail(code, 4)},\n  ),\n)`;
  }
  return widget.notConverted ? `// not converted: ${widget.notConverted.join(', ')}\n${code}` : code;
}

function paragraphsCode(widget: TextWidgetFields, paragraphs: {texts: string[]; spacing: number}, styleCode?: string): string {
  const children = paragraphs.texts
    .map((text) => `    ${indentTail(singleTextCode(widget, text, styleCode), 4)},\n`)
    .join(`    SizedBox(height: ${paragraphs.spacing}),\n`);
  // Each paragraph Text is only as wide as its text, so the Column aligns them (textAlign only works
  // inside a Text's own width), and shrinks to its content so an enclosing Align can place it.
  const cross = widget.textAlign === 'center' ? 'center' : widget.textAlign === 'right' ? 'end' : 'start';
  return `Column(\n  mainAxisSize: MainAxisSize.min,\n  crossAxisAlignment: CrossAxisAlignment.${cross}, // inferred: paragraph spacing as separate Texts\n  children: [\n${children}  ],\n)`;
}

/**
 * Dart `Text(...)` (or `Text.rich`) for one string of `widget`. With runs, the spans replace `text`;
 * convertTextWidget never sets both runs and paragraphs, so the paragraph path always has plain text.
 */
function singleTextCode(widget: TextWidgetFields, text: string, styleCode?: string): string {
  const args: string[] = [];
  if (styleCode) args.push(`style: ${styleCode},`);
  if (widget.textAlign) args.push(`textAlign: TextAlign.${widget.textAlign},`);
  if (widget.maxLines) args.push(`maxLines: ${widget.maxLines},${widget.maxLinesInferred ? ' // inferred: floor(boxHeight / lineHeightPx)' : ''}`);
  // Without maxLines Flutter drops every line after the first overflowing one, so say so.
  if (widget.ellipsis) args.push(`overflow: TextOverflow.ellipsis,${widget.maxLinesUnknown ? ' // maxLines unknown: Figma gave no line count or box height' : ''}`);
  const lines = args.map((arg) => `  ${arg}\n`).join('');
  if (widget.runs) {
    const spans = widget.runs.map((run) => {
      const style = run.style && textStyleCode(run.style);
      return `    TextSpan(text: ${dartString(run.text)}${style ? `, style: ${style}` : ''}),\n`;
    }).join('');
    return `Text.rich(\n  TextSpan(children: [\n${spans}  ]),\n${lines})`;
  }
  if (args.length === 0) return `Text(${dartString(text)})`;
  return `Text(\n  ${dartString(text)},\n${lines})`;
}

/** `FontWeight.wN` on the 100-step grid, `FontWeight(n)` otherwise (variable fonts, 1-1000). */
function fontWeightCode(weight: number): string {
  return weight % 100 === 0 && weight >= 100 && weight <= 900 ? `FontWeight.w${weight}` : `FontWeight(${weight})`;
}

/**
 * Dart `TextStyle(...)` for `fields`, or undefined when there is nothing to emit.
 * `colorCode` replaces the fields' color with a Dart expression (a semantic color).
 */
export function textStyleCode(fields: TextStyleFields, colorCode?: string): string | undefined {
  const parts: string[] = [];
  if (fields.fontFamily) parts.push(`fontFamily: ${dartString(fields.fontFamily)}`);
  if (fields.fontSize) parts.push(`fontSize: ${fields.fontSize}`);
  if (fields.fontWeight) parts.push(`fontWeight: ${fontWeightCode(fields.fontWeight)}`);
  if (fields.italic !== undefined) parts.push(`fontStyle: FontStyle.${fields.italic ? 'italic' : 'normal'}`);
  if (colorCode) parts.push(`color: ${colorCode}`);
  else if (fields.color) parts.push(`color: Color(0x${fields.color.substring(1)})`);
  if (fields.letterSpacing !== undefined) parts.push(`letterSpacing: ${fields.letterSpacing}`);
  if (fields.height !== undefined) {
    // Figma splits leading like CSS half-leading; Flutter's default is proportional.
    parts.push(`height: ${fields.height}`, 'leadingDistribution: TextLeadingDistribution.even');
  }
  if (fields.decoration) parts.push(`decoration: TextDecoration.${fields.decoration}`);
  if (fields.fontFeatures?.length === 0) parts.push('fontFeatures: const []');
  else if (fields.fontFeatures) {
    parts.push(`fontFeatures: [${fields.fontFeatures.map((tag) => `FontFeature.enable('${tag}')`).join(', ')}] /* inferred */`);
  }
  return parts.length > 0 ? `TextStyle(${parts.join(', ')})` : undefined;
}
