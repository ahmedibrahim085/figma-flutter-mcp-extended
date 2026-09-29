// src/extractors/flutter/text-style.ts

// The one place a text's Flutter TextStyle is written. Both component code paths
// (the deduplicated style library and the plain text-widget guidance) call it, so a
// text renders the same whichever path runs.

/** The Figma text properties the generated TextStyle is built from. */
export interface TextStyleFields {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  /** `#RRGGBB` of the text's first fill. */
  color?: string;
}

function fontWeightCode(weight: number): string {
  if (weight >= 700) return 'FontWeight.bold';
  if (weight >= 600) return 'FontWeight.w600';
  if (weight >= 500) return 'FontWeight.w500';
  if (weight <= 300) return 'FontWeight.w300';
  return 'FontWeight.normal';
}

/**
 * Dart `TextStyle(...)` for `fields`, or undefined when there is nothing to emit.
 * `colorCode` replaces the fields' color with a Dart expression (a semantic color).
 */
export function textStyleCode(fields: TextStyleFields, colorCode?: string): string | undefined {
  const parts: string[] = [];
  if (fields.fontFamily) parts.push(`fontFamily: '${fields.fontFamily}'`);
  if (fields.fontSize) parts.push(`fontSize: ${fields.fontSize}`);
  if (fields.fontWeight && fields.fontWeight !== 400) parts.push(`fontWeight: ${fontWeightCode(fields.fontWeight)}`);
  if (colorCode) parts.push(`color: ${colorCode}`);
  else if (fields.color) parts.push(`color: Color(0xFF${fields.color.substring(1)})`);
  return parts.length > 0 ? `TextStyle(${parts.join(', ')})` : undefined;
}
