// src/extractors/screens/extractor.mts

import type {FigmaNode} from '../../types/figma.js';
import type {
    ScreenMetadata,
    ScreenLayoutInfo,
    ScreenChild,
    SkippedNodeInfo,
    ScreenExtractionOptions
} from './types.js';
import type {ComponentChild, NestedComponentInfo} from '../components/types.js';
import {
    extractLayoutInfo,
    extractStylingInfo,
    createComponentChild,
    createNestedComponentInfo,
    isComponentNode
} from '../components/extractor.js';
import {filterEffectivelyVisibleChildren} from '../../utils/visibility.js';

/**
 * Extract screen metadata
 */
export function extractScreenMetadata(node: FigmaNode): ScreenMetadata {
    const box = node.absoluteBoundingBox;

    return {
        name: node.name,
        type: node.type as 'FRAME' | 'PAGE' | 'COMPONENT',
        nodeId: node.id,
        ...(box ? {dimensions: {width: box.width, height: box.height}} : {})
    };
}

/**
 * Extract screen layout information
 */
export function extractScreenLayoutInfo(node: FigmaNode): ScreenLayoutInfo {
    return {
        ...extractLayoutInfo(node),
        // Figma's overflowDirection is set on a frame that scrolls.
        scrollable: !!node.overflowDirection
    };
}

/**
 * List the visible child layers in Figma layer order, up to maxChildNodes; the rest are named in skippedNodes.
 */
export function analyzeScreenChildren(
    node: FigmaNode,
    options: Required<ScreenExtractionOptions>
): {
    children: ScreenChild[];
    components: NestedComponentInfo[];
    skippedNodes: SkippedNodeInfo[];
} {
    const children: ScreenChild[] = [];
    const components: NestedComponentInfo[] = [];
    const skippedNodes: SkippedNodeInfo[] = [];

    const visibleChildren = filterEffectivelyVisibleChildren(node.children ?? [], options.includeHiddenNodes);

    visibleChildren.forEach((child, index) => {
        if (index >= options.maxChildNodes) {
            skippedNodes.push({nodeId: child.id, name: child.name, type: child.type, reason: 'max_child_nodes'});
            return;
        }
        const screenChild = createScreenChild(child, node, options);
        children.push(screenChild);
        screenChild.components.forEach(comp => {
            if (!components.find(c => c.nodeId === comp.nodeId)) {
                components.push(comp);
            }
        });
    });

    return {children, components, skippedNodes};
}

/**
 * Create a screen child, with its bounds relative to the parent frame
 */
function createScreenChild(
    node: FigmaNode,
    parent: FigmaNode,
    options: Required<ScreenExtractionOptions>
): ScreenChild {
    const children: ComponentChild[] = [];
    const components: NestedComponentInfo[] = [];

    if (node.children) {
        const visibleChildren = filterEffectivelyVisibleChildren(
            node.children,
            options.includeHiddenNodes
        );

        visibleChildren.forEach(child => {
            const isComponent = isComponentNode(child);

            if (isComponent) {
                components.push(createNestedComponentInfo(child));
            }

            const siblings = visibleChildren.filter(sibling => sibling.id !== child.id);
            children.push(createComponentChild(child, isComponent, {
                maxChildNodes: 20, // Higher limit for screens
                maxDepth: options.maxDepth,
                includeHiddenNodes: options.includeHiddenNodes,
                extractTextContent: true
            }, node, siblings));
        });
    }

    const box = node.absoluteBoundingBox;
    const parentBox = parent.absoluteBoundingBox;

    return {
        nodeId: node.id,
        name: node.name,
        type: node.type,
        ...(node.scrollBehavior ? {scrollBehavior: node.scrollBehavior} : {}),
        ...(box && parentBox ? {bounds: {x: box.x - parentBox.x, y: box.y - parentBox.y, width: box.width, height: box.height}} : {}),
        layout: extractLayoutInfo(node),
        styling: extractStylingInfo(node),
        children,
        components
    };
}
