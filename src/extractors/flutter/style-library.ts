// src/extractors/flutter/style-library.mts

import {createHash} from 'node:crypto';
import {argbHex, dartColor} from '../../utils/dart-color.js';
import { Logger } from '../../utils/logger.js';
import { textStyleCode, type TextStyleFields } from './text-style.js';

export interface FlutterStyleDefinition {
  id: string;
  category: 'decoration' | 'text' | 'layout' | 'padding';
  properties: Record<string, any>;
  flutterCode: string;
  hash: string;
  semanticHash: string;
  usageCount: number;
}

export interface OptimizationReport {
  totalStyles: number;
  duplicatesRemoved: number;
  memoryReduction: string;
}

/**
 * JSON with object keys sorted at every depth. A key-array replacer
 * (`JSON.stringify(obj, keys)`) filters nested objects to those keys, so
 * different gradients or effects hashed the same.
 */
export function stableStringify(value: any): string {
    return JSON.stringify(value, (key, value) => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Sort object keys for consistent hashing
        const sortedObj: any = {};
        Object.keys(value).sort().forEach(k => {
          sortedObj[k] = value[k];
        });
        return sortedObj;
      }
      return value;
    });
}

export class FlutterStyleLibrary {
  private styles = new Map<string, FlutterStyleDefinition>();
  private hashToId = new Map<string, string>();
  private semanticHashToId = new Map<string, string>();
  
  addStyle(category: string, properties: any, context?: string): string {
    const hash = this.generateHash(properties);
    const semanticHash = this.generateSemanticHash(properties);
    
    Logger.info(`🎨 Adding ${category} style with properties:`, JSON.stringify(properties, null, 2));
    Logger.info(`📝 Generated hashes - Exact: ${hash.substring(0, 20)}..., Semantic: ${semanticHash.substring(0, 20)}...`);
    
    // Check for exact matches first
    if (this.hashToId.has(hash)) {
      const existingId = this.hashToId.get(hash)!;
      const style = this.styles.get(existingId)!;
      style.usageCount++;
      Logger.info(`✅ Exact match found! Reusing style ${existingId} (usage: ${style.usageCount})`);
      return existingId;
    }
    
    // Check for semantic equivalents
    if (this.semanticHashToId.has(semanticHash)) {
      const existingId = this.semanticHashToId.get(semanticHash)!;
      const style = this.styles.get(existingId)!;
      style.usageCount++;
      Logger.info(`🔍 Semantic match found! Reusing style ${existingId} (usage: ${style.usageCount})`);
      return existingId;
    }
    
    const flutterCode = this.generateFlutterCode(category, properties);
    const generatedId = this.generateId(flutterCode, semanticHash);
    const styleId = `${category}${generatedId.charAt(0).toUpperCase()}${generatedId.slice(1)}`;
    const definition: FlutterStyleDefinition = {
      id: styleId,
      category: category as any,
      properties,
      flutterCode,
      hash,
      semanticHash,
      usageCount: 1
    };
    
    Logger.info(`✨ Created new style: ${styleId} (total styles: ${this.styles.size + 1})`);
    
    this.styles.set(styleId, definition);
    this.hashToId.set(hash, styleId);
    this.semanticHashToId.set(semanticHash, styleId);
    
    
    return styleId;
  }
  
  getStyle(id: string): FlutterStyleDefinition | undefined {
    return this.styles.get(id);
  }
  
  getAllStyles(): FlutterStyleDefinition[] {
    return Array.from(this.styles.values());
  }
  
  optimizeLibrary(): OptimizationReport {
    const beforeCount = this.styles.size;
    let duplicatesRemoved = 0;
    
    // Find and merge exact duplicates (shouldn't happen with current logic, but safety check)
    const hashGroups = new Map<string, string[]>();
    for (const [id, style] of this.styles) {
      const group = hashGroups.get(style.hash) || [];
      group.push(id);
      hashGroups.set(style.hash, group);
    }
    
    // Remove duplicates (keep first, redirect others)
    for (const [hash, ids] of hashGroups) {
      if (ids.length > 1) {
        const keepId = ids[0];
        const keepStyle = this.styles.get(keepId)!;
        
        for (let i = 1; i < ids.length; i++) {
          const removeId = ids[i];
          const removeStyle = this.styles.get(removeId)!;
          
          // Merge usage counts
          keepStyle.usageCount += removeStyle.usageCount;
          
          // Remove duplicate
          this.styles.delete(removeId);
          this.hashToId.delete(removeStyle.hash);
          this.semanticHashToId.delete(removeStyle.semanticHash);
          duplicatesRemoved++;
        }
      }
    }
    
    const afterCount = this.styles.size;
    const memoryReduction = beforeCount > 0 
      ? `${((beforeCount - afterCount) / beforeCount * 100).toFixed(1)}%`
      : '0%';
    
    return {
      totalStyles: afterCount,
      duplicatesRemoved,
      memoryReduction
    };
  }
  
  private generateHash(properties: any): string {
    return stableStringify(properties);
  }
  
  private generateSemanticHash(properties: any): string {
    // Normalize property values before hashing
    const normalized = this.normalizeProperties(properties);
    Logger.info(`🔄 Normalized properties:`, JSON.stringify(normalized, null, 2));
    
    // Create semantic fingerprint that catches equivalent styles
    const semanticKey = this.createSemanticKey(normalized);
    Logger.info(`🔑 Semantic key:`, JSON.stringify(semanticKey, null, 2));
    
    return this.hashObject(semanticKey);
  }
  
  private normalizeProperties(properties: any): any {
    const normalized = JSON.parse(JSON.stringify(properties)); // Deep copy
    
    // Normalize color representations
    if (normalized.fills) {
      normalized.fills = normalized.fills.map((fill: any) => {
        if (fill.hex) {
          // Normalize hex colors (e.g., #000000 -> #000000, #000 -> #000000)
          let hex = fill.hex.toLowerCase();
          if (hex === '#000') hex = '#000000';
          if (hex === '#fff') hex = '#ffffff';
          
          const normalizedFill = { ...fill, hex };
          if (hex === '#000000') normalizedFill.normalized = 'black';
          if (hex === '#ffffff') normalizedFill.normalized = 'white';
          
          return normalizedFill;
        }
        return fill;
      });
    }
    
    // Normalize padding representations
    if (normalized.padding) {
      const p = normalized.padding;
      // EdgeInsets.all(8) === EdgeInsets.fromLTRB(8,8,8,8)
      if (p.top === p.right && p.right === p.bottom && p.bottom === p.left) {
        normalized.padding = { uniform: p.top, isUniform: true };
      }
    }
    
    // Normalize border radius
    if (normalized.cornerRadius && typeof normalized.cornerRadius === 'object') {
      const r = normalized.cornerRadius;
      if (r.topLeft === r.topRight && r.topRight === r.bottomLeft && r.bottomLeft === r.bottomRight) {
        normalized.cornerRadius = r.topLeft;
      }
    }
    
    return normalized;
  }
  
  private createSemanticKey(properties: any): any {
    // Create a semantic representation that focuses on visual impact
    const key: any = {};
    
    // Group similar properties - be more specific to avoid false matches
    if (properties.fills && properties.fills.length > 0) {
      // Use the actual hex value to distinguish different colors
      key.color = (argbHex(properties.fills[0]) ?? properties.fills[0].hex)?.toLowerCase();
      if (properties.fills.some((fill: any) => fill.blendMode)) key.fills = properties.fills;
      // Gradient/image and stacked fills have no single hex; without the full
      // fills every such style shared one key.
      if (properties.fills.length > 1 || (properties.fills[0] && properties.fills[0].type !== 'SOLID')) {
        key.fills = properties.fills;
      }
    }
    
    if (properties.cornerRadius !== undefined) {
      key.borderRadius = typeof properties.cornerRadius === 'number' 
        ? properties.cornerRadius 
        : JSON.stringify(properties.cornerRadius);
    }
    
    if (properties.padding) {
      key.padding = properties.padding.isUniform 
        ? properties.padding.uniform 
        : JSON.stringify(properties.padding);
    }
    
    // Properties without a normalised form still separate styles. Text styles
    // (fontSize, fontWeight, ...) used to produce an empty key, so every text
    // reused the first text's style. Empty effects equal absent effects.
    for (const [name, value] of Object.entries(properties)) {
      if (['fills', 'cornerRadius', 'padding'].includes(name) || value === undefined) continue;
      if (name === 'effects' && value && Object.values(value as object).every(v => Array.isArray(v) && v.length === 0)) continue;
      key[name] = value;
    }
    
    if (properties.effects?.dropShadows?.length > 0) {
      key.hasShadow = true;
      key.shadowIntensity = properties.effects.dropShadows.length;
      // Include shadow details for more specificity
      key.shadowDetails = properties.effects.dropShadows.map((s: any) => ({
        color: argbHex({color: s.color})?.toLowerCase() ?? s.hex,
        blur: s.radius,
        offset: s.offset
      }));
    }
    
    return key;
  }
  
  private hashObject(obj: any): string {
    return stableStringify(obj);
  }
  
  /**
   * 12 base36 characters from a hash of the style's Dart code and its semantic key, so the same style has the same id in
   * every call and session. The key is in the hash because the Dart code alone leaves out what other readers use (extra
   * fill layers), and two such styles must not share an id.
   */
  private generateId(flutterCode: string, semanticHash: string): string {
    const digest = createHash('sha256').update(`${flutterCode}\0${semanticHash}`).digest('hex');
    return BigInt(`0x${digest.slice(0, 15)}`).toString(36).padStart(12, '0');
  }
  
  private generateFlutterCode(category: string, properties: any): string {
    switch (category) {
      case 'decoration':
        return FlutterCodeGenerator.generateDecoration(properties);
      case 'text':
        return FlutterCodeGenerator.generateTextStyle(properties);
      case 'padding':
        return FlutterCodeGenerator.generatePadding(properties);
      case 'layout':
        // Layout code generation can be added later
        return `// ${category} implementation`;
      default:
        return `// ${category} implementation`;
    }
  }
}

/** Multi-line code with every line after the first indented by `spaces`, to sit inside an indented property. */
export function indentContinuation(code: string, spaces: number): string {
  return code.split('\n').join(`\n${' '.repeat(spaces)}`);
}

export class FlutterCodeGenerator {
  /** BoxDecoration for the bottom fill, with the radius, border and shadows. Later fills are layers (generateFillLayers). */
  static generateDecoration(properties: any): string {
    let code = 'BoxDecoration(\n';
    
    if (properties.fills?.length > 0) {
      const color = dartColor(properties.fills[0]);
      if (color) {
        code += `${FlutterCodeGenerator.blendNote(properties.fills[0])}  color: ${color},\n`;
      }
    }
    
    code += FlutterCodeGenerator.radiusLines(properties);
    
    if (properties.effects?.dropShadows?.length > 0) {
      code += `  boxShadow: [\n`;
      properties.effects.dropShadows.forEach((shadow: any) => {
        code += `    BoxShadow(\n`;
        code += `      color: ${dartColor({color: shadow.color})},\n`;
        code += shadow.offset
          ? `      offset: Offset(${shadow.offset.x}, ${shadow.offset.y}),\n`
          : `      // offset: not set by Figma\n`;
        code += `      blurRadius: ${shadow.radius},\n`;
        if (shadow.spread) {
          code += `      spreadRadius: ${shadow.spread},\n`;
        }
        code += `    ),\n`;
      });
      code += `  ],\n`;
    }
    
    code += ')';
    return code;
  }

  /**
   * One BoxDecoration per fill after the first, bottom to top: Figma draws the last fill on top, so each is
   * nested inside the previous one (DecoratedBox paints behind its child).
   */
  static generateFillLayers(properties: any): string[] {
    // A layer with no solid colour (a gradient or image fill) paints nothing here; those fills are not converted yet.
    return (properties.fills ?? []).slice(1).filter((fill: any) => dartColor(fill)).map((fill: any) =>
      `BoxDecoration(\n${FlutterCodeGenerator.blendNote(fill)}  color: ${dartColor(fill)},\n${FlutterCodeGenerator.radiusLines(properties)})`);
  }

  /** The layers as nested DecoratedBoxes (the first outermost) around `inner`, or nothing when there are none. */
  static nestFillLayers(layers: string[], inner?: string): string {
    let code = inner;
    for (let i = layers.length - 1; i >= 0; i--) {
      code = `DecoratedBox(\n  decoration: ${indentContinuation(layers[i], 2)},\n${code ? `  child: ${indentContinuation(code, 2)},\n` : ''})`;
    }
    return code ?? '';
  }

  /** A blend mode other than NORMAL is not applied to a DecoratedBox fill; say so in the code. */
  private static blendNote(fill: any): string {
    return fill.blendMode ? `  // approximate: blend ${fill.blendMode} not applied\n` : '';
  }

  private static radiusLines(properties: any): string {
    if (properties.cornerRadius === undefined) return '';
    if (typeof properties.cornerRadius === 'number') {
      return `  borderRadius: BorderRadius.circular(${properties.cornerRadius}),\n`;
    }
    const r = properties.cornerRadius;
    return `  borderRadius: BorderRadius.only(\n`
      + `    topLeft: Radius.circular(${r.topLeft}),\n`
      + `    topRight: Radius.circular(${r.topRight}),\n`
      + `    bottomLeft: Radius.circular(${r.bottomLeft}),\n`
      + `    bottomRight: Radius.circular(${r.bottomRight}),\n`
      + `  ),\n`;
  }
  
  static generatePadding(properties: any): string {
    const p = properties.padding;
    if (!p) return 'EdgeInsets.zero';
    
    if (p.isUniform) {
      return `EdgeInsets.all(${p.top})`;
    }
    return `EdgeInsets.fromLTRB(${p.left}, ${p.top}, ${p.right}, ${p.bottom})`;
  }
  
  static generateTextStyle(properties: TextStyleFields): string {
    return textStyleCode(properties) ?? 'TextStyle()';
  }
}
