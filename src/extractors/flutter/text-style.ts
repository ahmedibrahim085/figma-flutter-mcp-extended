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
  };
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
  if (fields.fontFamily) parts.push(`fontFamily: '${fields.fontFamily}'`);
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
  return parts.length > 0 ? `TextStyle(${parts.join(', ')})` : undefined;
}
