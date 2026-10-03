import type {ColorInfo, StrokeInfo} from '../extractors/components/types.js';
import {effectiveAlpha} from './dart-color.js';

/** `#RRGGBB` (or the paint type) plus the effective opacity, the colour's alpha times the paint opacity, when not 100%. */
export function describeFill(fill: ColorInfo): string {
    const base = fill.hex ?? fill.type;
    const alpha = fill.color ? effectiveAlpha(fill.color, fill.opacity) : (fill.opacity ?? 1);
    return alpha === 1 ? base : `${base} (${Math.round(alpha * 100)}% opacity)`;
}

/**
 * The fills Figma sends, bottom to top: the last fill is drawn on top. One fill reads as the background.
 */
export function formatFills(fills: ColorInfo[] | undefined, indent: string = '', linePrefix: string = '- '): string {
    if (!fills || fills.length === 0) return '';
    return fills.length === 1
        ? `${indent}${linePrefix}Background: ${describeFill(fills[0])}\n`
        : `${indent}${linePrefix}Fills (bottom to top): ${fills.map(describeFill).join(', ')}\n`;
}

/** A stroke's weight as Figma sent it: "2px", per-side weights, or that Figma sent none. */
export function describeStrokeWeight(stroke: StrokeInfo): string {
    const sides = stroke.individualWeights;
    if (sides) return `top ${sides.top}px, right ${sides.right}px, bottom ${sides.bottom}px, left ${sides.left}px`;
    return stroke.weight === undefined ? 'strokeWeight not set by Figma' : `${stroke.weight}px`;
}
