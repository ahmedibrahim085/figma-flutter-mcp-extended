// src/extractors/flutter/text-style.ts

// The one place a text's Flutter TextStyle is written. Both component code paths
// (the deduplicated style library and the plain text-widget guidance) call it, so a
// text renders the same whichever path runs. Conversion rules: research 03b.

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

/** Figma's text fields, as the REST TypeStyle carries them. */
export interface FigmaTypeStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  letterSpacing?: number;
  lineHeightPx?: number;
  lineHeightUnit?: string;
  lineHeightPercentFontSize?: number;
  textDecoration?: string;
}

/**
 * TextStyle fields from a Figma TypeStyle and the text's color.
 * Line height: PIXELS and Auto (INTRINSIC_%) are lineHeightPx / fontSize; FONT_SIZE_% is percent / 100.
 */
export function toTextStyleFields(style: FigmaTypeStyle, color?: string): TextStyleFields {
  const {fontSize} = style;
  const height = style.lineHeightUnit === 'FONT_SIZE_%' && style.lineHeightPercentFontSize
    ? style.lineHeightPercentFontSize / 100
    : style.lineHeightPx && fontSize ? style.lineHeightPx / fontSize : undefined;
  return {
    fontFamily: style.fontFamily,
    fontSize,
    fontWeight: style.fontWeight,
    italic: style.italic === true || undefined,
    color,
    // Figma's default is 0; emitting it keeps Material 3's 0.25 from being inherited.
    letterSpacing: style.letterSpacing ?? 0,
    height: height === undefined ? undefined : Number(height.toFixed(4)),
    decoration: style.textDecoration === 'UNDERLINE' ? 'underline'
      : style.textDecoration === 'STRIKETHROUGH' ? 'lineThrough' : undefined,
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
