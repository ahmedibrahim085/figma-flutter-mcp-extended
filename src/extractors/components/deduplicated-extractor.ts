// src/extractors/components/deduplicated-extractor.mts

import type { FigmaNode } from '../../types/figma.js';
import type { FlutterStyleDefinition } from '../flutter/style-library.js';
import { FlutterStyleLibrary } from '../flutter/style-library.js';
import type { TextWidgetFields } from '../flutter/text-style.js';
import { GlobalStyleManager } from '../flutter/global-vars.js';
import { 
  extractStylingInfo, 
  extractLayoutInfo, 
  extractMetadata,
  extractTextInfo,
  createNestedComponentInfo,
  isComponentNode
} from './extractor.js';
import type {
  ComponentMetadata,
  LayoutInfo,
  StylingInfo,
  NestedComponentInfo,
  TextInfo
} from './types.js';
import { isEffectivelyVisible } from '../../utils/visibility.js';

export interface DeduplicatedComponentAnalysis {
  metadata: ComponentMetadata;
  layout: LayoutInfo;
  styleRefs: Record<string, string>;
  children: DeduplicatedComponentChild[];
  nestedComponents: NestedComponentInfo[];
  newStyleDefinitions?: Record<string, FlutterStyleDefinition>;
}

export interface DeduplicatedComponentChild {
  nodeId: string;
  name: string;
  type: string;
  styleRefs: string[];
  layout: LayoutInfo;
  semanticType?: string;
  textContent?: string;
  /** Text-widget fields (letter case applied, alignment, truncation). */
  textWidget?: TextWidgetFields;
  /** This child's own visible children, for frames and groups rendered inline. */
  children?: DeduplicatedComponentChild[];
  /** True when the child has children below the depth limit, which are not analysed. */
  truncated?: boolean;
}

/** How many frame levels below the component are analysed; deeper content is named as an approximation. */
export const MAX_CHILD_DEPTH = 8;

/** Types rendered as a placeholder and analysed separately, never inlined. */
export const NESTED_COMPONENT_TYPES = new Set(['INSTANCE', 'COMPONENT', 'COMPONENT_SET']);

export class DeduplicatedComponentExtractor {
  private styleLibrary = FlutterStyleLibrary.getInstance();
  private globalStyleManager = new GlobalStyleManager();
  
  async analyzeComponent(node: FigmaNode, trackNewStyles = false): Promise<DeduplicatedComponentAnalysis> {
    const styling = extractStylingInfo(node);
    const layout = extractLayoutInfo(node);
    const metadata = extractMetadata(node, false); // assuming not user-defined unless specified
    
    const styleRefs: Record<string, string> = {};
    const newStyles = new Set<string>();
    
    // Process decoration styles using the enhanced global style manager
    if (this.hasDecorationProperties(styling)) {
      const beforeCount = this.styleLibrary.getAllStyles().length;
      styleRefs.decoration = this.globalStyleManager.addStyle({
        fills: styling.fills,
        cornerRadius: styling.cornerRadius,
        effects: styling.effects
      }, 'decoration');
      if (trackNewStyles && this.styleLibrary.getAllStyles().length > beforeCount) {
        newStyles.add(styleRefs.decoration);
      }
    }
    
    // Process padding styles using the enhanced global style manager
    if (layout.padding) {
      const beforeCount = this.styleLibrary.getAllStyles().length;
      styleRefs.padding = this.globalStyleManager.addStyle({ padding: layout.padding }, 'padding');
      if (trackNewStyles && this.styleLibrary.getAllStyles().length > beforeCount) {
        newStyles.add(styleRefs.padding);
      }
    }
    
    // Process children with deduplication
    const children = await this.analyzeChildren(node);
    const nestedComponents = this.extractNestedComponents(node);
    
    const result: DeduplicatedComponentAnalysis = {
      metadata,
      layout,
      styleRefs,
      children,
      nestedComponents
    };
    
    if (trackNewStyles && newStyles.size > 0) {
      result.newStyleDefinitions = this.getStyleDefinitions(Array.from(newStyles));
    }
    
    return result;
  }
  
  private async analyzeChildren(node: FigmaNode, depth = 1): Promise<DeduplicatedComponentChild[]> {
    if (!node.children) return [];
    
    const children: DeduplicatedComponentChild[] = [];
    
    for (const child of node.children) {
      if (!isEffectivelyVisible(child)) continue;

      const childStyleRefs: string[] = [];
      const childLayout = extractLayoutInfo(child);
      
      // Extract child styling using enhanced global style manager
      const childStyling = extractStylingInfo(child);
      if (this.hasDecorationProperties(childStyling)) {
        const decorationRef = this.globalStyleManager.addStyle({
          fills: childStyling.fills,
          cornerRadius: childStyling.cornerRadius,
          effects: childStyling.effects
        }, 'decoration');
        childStyleRefs.push(decorationRef);
      }
      if (child.type !== 'TEXT' && !NESTED_COMPONENT_TYPES.has(child.type) && childLayout.padding) {
        childStyleRefs.push(this.globalStyleManager.addStyle({ padding: childLayout.padding }, 'padding'));
      }
      
      // Extract text styling for text nodes using enhanced global style manager
      let textContent: string | undefined;
      let textWidget: TextWidgetFields | undefined;
      if (child.type === 'TEXT') {
        const textInfo = extractTextInfo(child);
        if (textInfo) {
          textContent = textInfo.content;
          textWidget = textInfo.widget;
          
          // Add text style to library using enhanced deduplication
          if (textInfo.style) {
            const textStyleRef = this.globalStyleManager.addStyle(textInfo.style, 'text');
            childStyleRefs.push(textStyleRef);
          }
        }
      }
      
      // Frames and groups render their own children inline, down to MAX_CHILD_DEPTH.
      const hasVisibleChildren = child.type !== 'TEXT' && !NESTED_COMPONENT_TYPES.has(child.type)
        && (child.children ?? []).some(grandchild => isEffectivelyVisible(grandchild));
      const truncated = hasVisibleChildren && depth >= MAX_CHILD_DEPTH;
      const grandchildren = hasVisibleChildren && !truncated ? await this.analyzeChildren(child, depth + 1) : undefined;

      children.push({
        nodeId: child.id,
        name: child.name,
        type: child.type,
        styleRefs: childStyleRefs,
        layout: childLayout,
        semanticType: this.detectSemanticType(child),
        textContent,
        textWidget,
        ...(grandchildren ? {children: grandchildren} : {}),
        ...(truncated ? {truncated: true} : {})
      });
    }
    
    return children;
  }
  
  private hasDecorationProperties(styling: StylingInfo): boolean {
    return !!(styling.fills?.length || styling.cornerRadius !== undefined || styling.effects?.dropShadows?.length);
  }
  
  private extractTextContent(node: any): string {
    return node.characters || node.name || '';
  }
  
  private detectSemanticType(node: any): string | undefined {
    // Simplified semantic detection
    if (node.type === 'TEXT') {
      const content = this.extractTextContent(node).toLowerCase();
      if (['click', 'submit', 'save', 'cancel'].some(word => content.includes(word))) {
        return 'button';
      }
      return 'text';
    }
    return undefined;
  }
  
  private extractNestedComponents(node: FigmaNode): NestedComponentInfo[] {
    if (!node.children) return [];
    
    const nestedComponents: NestedComponentInfo[] = [];
    
    for (const child of node.children) {
      if (!isEffectivelyVisible(child)) continue;
      if (isComponentNode(child)) {
        nestedComponents.push(createNestedComponentInfo(child));
      }
    }
    
    return nestedComponents;
  }
  
  private getStyleDefinitions(styleIds: string[]): Record<string, FlutterStyleDefinition> {
    const definitions: Record<string, FlutterStyleDefinition> = {};
    styleIds.forEach(id => {
      const definition = this.styleLibrary.getStyle(id);
      if (definition) {
        definitions[id] = definition;
      }
    });
    return definitions;
  }
}
