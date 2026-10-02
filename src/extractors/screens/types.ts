// src/extractors/screens/types.mts

import type {FigmaNode} from '../../types/figma.js';
import type {ComponentChild, NestedComponentInfo, LayoutInfo, StylingInfo} from '../components/types.js';

/**
 * Main screen analysis result
 */
export interface ScreenAnalysis {
    metadata: ScreenMetadata;
    layout: ScreenLayoutInfo;
    children: ScreenChild[];
    components: NestedComponentInfo[];
    skippedNodes?: SkippedNodeInfo[];
}

/**
 * Screen metadata information
 */
export interface ScreenMetadata {
    name: string;
    type: 'FRAME' | 'PAGE' | 'COMPONENT';
    nodeId: string;
    description?: string;
    /** Absent when the frame has no bounding box. */
    dimensions?: {
        width: number;
        height: number;
    };
}

/**
 * Screen layout information optimized for top-level frames
 */
export interface ScreenLayoutInfo extends LayoutInfo {
    scrollable?: boolean;
}

/**
 * A visible child layer of the screen frame, in Figma layer order.
 */
export interface ScreenChild {
    nodeId: string;
    name: string;
    type: string;
    /** Figma scrollBehavior of this child: FIXED layers stay put while the parent scrolls. */
    scrollBehavior?: FigmaNode['scrollBehavior'];
    /** Position and size relative to the parent frame (child bounds minus parent bounds). */
    bounds?: {x: number; y: number; width: number; height: number};
    layout: Partial<LayoutInfo>;
    styling?: Partial<StylingInfo>;
    children: ComponentChild[];
    components: NestedComponentInfo[];
}

/**
 * Information about nodes that were skipped
 */
export interface SkippedNodeInfo {
    nodeId: string;
    name: string;
    type: string;
    reason: 'max_child_nodes';
}

/**
 * Screen extraction options
 */
export interface ScreenExtractionOptions {
    maxChildNodes?: number;
    maxDepth?: number;
    includeHiddenNodes?: boolean;
}
