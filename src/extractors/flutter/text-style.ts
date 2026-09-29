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
  italic?: boolean;
  /** `#AARRGGBB` of the text's first fill, paint opacity included. */
  color?: string;
  /** Logical pixels (Figma REST gives px). */
  letterSpacing?: number;
  /** Line height as a multiple of fontSize, when Figma gives one. */
  height?: number;
  decoration?: 'underline' | 'lineThrough';
  /** OpenType tags for small caps (INFERRED mapping, research 03b). */
  fontFeatures?: string[];
}

/** The Text-widget side of a text: the string as written and the fields TextStyle cannot hold. */
export interface TextWidgetFields {
  /** The string after Figma's letter case is applied. */
  text: string;
  textAlign?: 'center' | 'right' | 'justify';
  maxLines?: number;
  /** True when maxLines was derived from the box height, not given by Figma. */
  maxLinesInferred?: boolean;
  ellipsis?: boolean;
  /** Truncated, but neither Figma nor the box gives a line count. */
  maxLinesUnknown?: boolean;
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

/** Figma letter case, baked into the string: Flutter has no text-transform style. */
function applyTextCase(text: string, textCase?: string): string {
  if (textCase === 'UPPER') return text.toUpperCase();
  if (textCase === 'LOWER') return text.toLowerCase();
  // A word starts after any character that is not a letter, digit or apostrophe.
  if (textCase === 'TITLE') return text.replace(/(^|[^\p{L}\p{N}'\u2019])(\p{L})/gu, (_, before: string, first: string) => before + first.toUpperCase());
  return text;
}

/**
 * Text-widget fields for a text node's content, TypeStyle and box height.
 * Ending truncation gives maxLines + ellipsis; with no maxLines from Figma the count is
 * floor(boxHeight / lineHeightPx), which research 03b marks as an inferred rule.
 */
export function convertTextWidget(content: string, style?: FigmaTextStyle, boxHeight?: number): TextWidgetFields {
  const widget: TextWidgetFields = {text: applyTextCase(content, style?.textCase)};
  const aligns: Record<string, TextWidgetFields['textAlign']> = {CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify'};
  if (style?.textAlignHorizontal) widget.textAlign = aligns[style.textAlignHorizontal];
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
  return widget;
}

/** A single-quoted Dart string literal: `'`, `\`, `$` and newlines escaped. */
export function dartString(text: string): string {
  return `'${text.replace(/[\\'$]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')}'`;
}

/** Dart `Text(...)` for `widget`, with `styleCode` as its style when given. */
export function textWidgetCode(widget: TextWidgetFields, styleCode?: string): string {
  const args: string[] = [];
  if (styleCode) args.push(`style: ${styleCode},`);
  if (widget.textAlign) args.push(`textAlign: TextAlign.${widget.textAlign},`);
  if (widget.maxLines) args.push(`maxLines: ${widget.maxLines},${widget.maxLinesInferred ? ' // inferred: floor(boxHeight / lineHeightPx)' : ''}`);
  // Without maxLines Flutter drops every line after the first overflowing one, so say so.
  if (widget.ellipsis) args.push(`overflow: TextOverflow.ellipsis,${widget.maxLinesUnknown ? ' // maxLines unknown: Figma gave no line count or box height' : ''}`);
  if (args.length === 0) return `Text(${dartString(widget.text)})`;
  return `Text(\n  ${dartString(widget.text)},\n${args.map((arg) => `  ${arg}\n`).join('')})`;
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
  if (fields.italic) parts.push('fontStyle: FontStyle.italic');
  if (colorCode) parts.push(`color: ${colorCode}`);
  else if (fields.color) parts.push(`color: Color(0x${fields.color.substring(1)})`);
  if (fields.letterSpacing !== undefined) parts.push(`letterSpacing: ${fields.letterSpacing}`);
  if (fields.height !== undefined) {
    // Figma splits leading like CSS half-leading; Flutter's default is proportional.
    parts.push(`height: ${fields.height}`, 'leadingDistribution: TextLeadingDistribution.even');
  }
  if (fields.decoration) parts.push(`decoration: TextDecoration.${fields.decoration}`);
  if (fields.fontFeatures) {
    parts.push(`fontFeatures: [${fields.fontFeatures.map((tag) => `FontFeature.enable('${tag}')`).join(', ')}] /* inferred */`);
  }
  return parts.length > 0 ? `TextStyle(${parts.join(', ')})` : undefined;
}
