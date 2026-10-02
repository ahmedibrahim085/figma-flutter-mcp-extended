// src/extractors/flutter/global-vars.ts

import { FlutterStyleLibrary, FlutterStyleDefinition, OptimizationReport, stableStringify } from './style-library.js';
import { Logger } from '../../utils/logger.js';

export interface GlobalVars {
  styles: Record<string, FlutterStyleDefinition>;
  usage: Record<string, number>;
}

export class GlobalStyleManager {
  private globalVars: GlobalVars = { styles: {}, usage: {} };
  private styleLibrary = FlutterStyleLibrary.getInstance();
  
  addStyle(properties: any, context?: string): string {
    Logger.info(`🌐 GlobalStyleManager: Adding style with context: ${context}`);
    
    // Check for exact matches first
    const exactMatch = this.findExactMatch(properties);
    if (exactMatch) {
      Logger.info(`🎯 GlobalStyleManager: Found exact match ${exactMatch}`);
      this.incrementUsage(exactMatch);
      return exactMatch;
    }
    
    // Check for semantic equivalents
    const semanticMatch = this.findSemanticMatch(properties);
    if (semanticMatch) {
      Logger.info(`🔍 GlobalStyleManager: Found semantic match ${semanticMatch}`);
      this.incrementUsage(semanticMatch);
      return semanticMatch;
    }
    
    return this.createNewStyle(properties, context);
  }
  
  private findExactMatch(properties: any): string | undefined {
    const hash = this.generateHash(properties);
    
    for (const [id, style] of Object.entries(this.globalVars.styles)) {
      if (style.hash === hash) {
        return id;
      }
    }
    
    return undefined;
  }
  
  private findSemanticMatch(properties: any): string | undefined {
    const semanticHash = this.generateSemanticHash(properties);
    
    for (const [id, style] of Object.entries(this.globalVars.styles)) {
      if (style.semanticHash === semanticHash) {
        return id;
      }
    }
    
    return undefined;
  }
  
  private createNewStyle(properties: any, context?: string): string {
    // Determine category from context or properties
    const category = this.determineCategory(properties, context);
    
    // Use the style library to create the style (it handles all the logic)
    const styleId = this.styleLibrary.addStyle(category, properties, context);
    const newStyle = this.styleLibrary.getStyle(styleId)!;
    
    // Update global vars
    this.globalVars.styles[styleId] = newStyle;
    this.globalVars.usage[styleId] = newStyle.usageCount;
    
    return styleId;
  }
  
  private determineCategory(properties: any, context?: string): string {
    if (context) return context;
    
    // Auto-detect category based on properties
    if (properties.fills || properties.cornerRadius || properties.effects) {
      return 'decoration';
    }
    
    if (properties.fontFamily || properties.fontSize || properties.fontWeight) {
      return 'text';
    }
    
    if (properties.padding) {
      return 'padding';
    }
    
    return 'layout';
  }
  
  private incrementUsage(styleId: string): void {
    if (this.globalVars.usage[styleId]) {
      this.globalVars.usage[styleId]++;
    } else {
      this.globalVars.usage[styleId] = 1;
    }
    
    // Also update the style library
    const style = this.styleLibrary.getStyle(styleId);
    if (style) {
      style.usageCount++;
    }
  }
  
  optimizeLibrary(): OptimizationReport {
    Logger.info(`🔧 GlobalStyleManager: Starting library optimization`);
    
    // Sync with style library first
    this.syncWithStyleLibrary();
    Logger.info(`🔄 GlobalStyleManager: Synced with style library`);
    
    // Run optimization on the style library
    const report = this.styleLibrary.optimizeLibrary();
    Logger.info(`📊 GlobalStyleManager: Optimization report:`, report);
    
    // Update global vars after optimization
    this.syncFromStyleLibrary();
    Logger.info(`✅ GlobalStyleManager: Optimization complete`);
    
    return report;
  }
  
  private syncWithStyleLibrary(): void {
    // Update style library with any changes from global vars
    const allStyles = this.styleLibrary.getAllStyles();
    
    for (const style of allStyles) {
      if (this.globalVars.usage[style.id] && this.globalVars.usage[style.id] !== style.usageCount) {
        style.usageCount = this.globalVars.usage[style.id];
      }
    }
  }
  
  private syncFromStyleLibrary(): void {
    // Update global vars with current state of style library
    const allStyles = this.styleLibrary.getAllStyles();
    
    this.globalVars.styles = {};
    this.globalVars.usage = {};
    
    for (const style of allStyles) {
      this.globalVars.styles[style.id] = style;
      this.globalVars.usage[style.id] = style.usageCount;
    }
  }
  
  getGlobalVars(): GlobalVars {
    this.syncFromStyleLibrary();
    return { ...this.globalVars };
  }
  
  getUsageStats(): Record<string, number> {
    return { ...this.globalVars.usage };
  }
  
  reset(): void {
    this.globalVars = { styles: {}, usage: {} };
    this.styleLibrary.reset();
  }
  
  // Helper methods (delegated to style library for consistency)
  private generateHash(properties: any): string {
    return stableStringify(properties);
  }
  
  private generateSemanticHash(properties: any): string {
    // This should match the logic in FlutterStyleLibrary
    // For now, delegate to a simplified version
    const normalized = this.normalizeProperties(properties);
    const semanticKey = this.createSemanticKey(normalized);
    return stableStringify(semanticKey);
  }
  
  private normalizeProperties(properties: any): any {
    const normalized = { ...properties };
    
    // Normalize color representations
    if (normalized.fills) {
      normalized.fills = normalized.fills.map((fill: any) => {
        if (fill.hex) {
          const hex = fill.hex.toLowerCase();
          if (hex === '#000000') return { ...fill, hex: '#000', normalized: 'black' };
          if (hex === '#ffffff') return { ...fill, hex: '#fff', normalized: 'white' };
        }
        return fill;
      });
    }
    
    // Normalize padding representations
    if (normalized.padding) {
      const p = normalized.padding;
      if (p.top === p.right && p.right === p.bottom && p.bottom === p.left) {
        normalized.padding = { uniform: p.top, isUniform: true };
      }
    }
    
    return normalized;
  }
  
  private createSemanticKey(properties: any): any {
    const key: any = {};
    
    if (properties.fills) {
      key.color = properties.fills[0]?.normalized || properties.fills[0]?.hex;
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
    
    return key;
  }
}
