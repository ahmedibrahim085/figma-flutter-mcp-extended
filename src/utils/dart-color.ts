import type {FigmaColor} from '../types/figma.js';

/** `#AARRGGBB` of a paint or effect color: the color's alpha times the paint opacity. */
export function argbHex(paint: {color?: FigmaColor; opacity?: number}): string | undefined {
  if (!paint.color) return undefined;
  const {r, g, b, a} = paint.color;
  const alpha = (a ?? 1) * (paint.opacity ?? 1);
  return `#${[alpha, r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Dart `Color(0xAARRGGBB)` for a paint or effect color. */
export function dartColor(paint: {color?: FigmaColor; opacity?: number}): string | undefined {
  const argb = argbHex(paint);
  return argb && `Color(0x${argb.slice(1)})`;
}
