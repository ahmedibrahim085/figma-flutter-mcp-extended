import {formatFills} from "../../../utils/paint-format.js";
import {convertFillToColorInfo} from "../../../extractors/components/extractor.js";
import {filterEffectivelyVisibleChildren, isEffectivelyVisible} from "../../../utils/visibility.js";
import {formatSizingAlignment} from "../../../utils/style-format.js";
import {budgetNote} from "../../../utils/budget.js";

/**
 * Generate structure inspection report
 */
/** The children an inspection lists: the visible ones, or every one with showAllChildren. */
export const inspectedChildren = (node: any, showAllChildren: boolean): any[] =>
    showAllChildren ? node.children ?? [] : filterEffectivelyVisibleChildren(node.children ?? [], false);

/** `limit` keeps the first n listed children; the others are named in omittedNodeIds (the response budget). */
export function generateStructureInspectionReport(node: any, showAllChildren: boolean, limit = Infinity): string {
    let output = `Component Structure Inspection\n\n`;

    output += `Component: ${node.name}\n`;
    output += `Type: ${node.type}\n`;
    output += `Node ID: ${node.id}\n`;
    output += `Children: ${node.children?.length || 0}\n`;

    if (node.absoluteBoundingBox) {
        const bbox = node.absoluteBoundingBox;
        output += `Dimensions: ${Math.round(bbox.width)}×${Math.round(bbox.height)}px\n`;
    }
    output += formatSizingAlignment({
        horizontal: node.layoutSizingHorizontal,
        vertical: node.layoutSizingVertical,
        align: node.layoutAlign
    });

    output += `\n`;

    if (!node.children || node.children.length === 0) {
        output += `This component has no children.\n`;
        return output;
    }

    const childrenSource = inspectedChildren(node, showAllChildren);
    const hiddenSkipped = (node.children?.length || 0) - childrenSource.length;

    output += `Child Structure:\n`;

    childrenSource.slice(0, limit).forEach((child: any, index: number) => {
        const isComponent = child.type === 'COMPONENT' || child.type === 'INSTANCE';
        const componentMark = isComponent ? ' [COMPONENT]' : '';
        const hiddenMark = child.visible === false ? ' [HIDDEN]' : '';
        const emptySlotMark =
            child.visible !== false && !isEffectivelyVisible(child)
                ? ' [EMPTY_HIDDEN_SLOT]'
                : '';

        output += `${index + 1}. ${child.name} (${child.type})${componentMark}${hiddenMark}${emptySlotMark}\n`;

        if (child.absoluteBoundingBox) {
            const bbox = child.absoluteBoundingBox;
            output += `   Size: ${Math.round(bbox.width)}×${Math.round(bbox.height)}px\n`;
        }
        output += formatSizingAlignment({
            horizontal: child.layoutSizingHorizontal,
            vertical: child.layoutSizingVertical,
            align: child.layoutAlign
        }, '   ');

        if (child.children && child.children.length > 0) {
            output += `   Contains: ${child.children.length} child nodes\n`;
        }

        // Show basic styling info
        output += formatFills((child.fills ?? []).filter((fill: any) => fill.visible !== false && fill.color).map(convertFillToColorInfo), '   ', '');
    });

    if (!showAllChildren && hiddenSkipped > 0) {
        output += `\nSkipped ${hiddenSkipped} hidden / empty-slot child(ren). Use showAllChildren: true to include them.\n`;
    }

    // Analysis recommendations
    output += `\nAnalysis Recommendations:\n`;
    const componentChildren = childrenSource.filter((child: any) =>
        child.type === 'COMPONENT' || child.type === 'INSTANCE'
    );

    if (componentChildren.length > 0) {
        output += `- Found ${componentChildren.length} nested components for separate analysis\n`;
    }

    const textChildren = node.children.filter((child: any) => child.type === 'TEXT');
    if (textChildren.length > 0) {
        output += `- Found ${textChildren.length} text nodes for content extraction\n`;
    }

    return output + budgetNote(childrenSource.slice(limit).map((child: any) => child.id));
}
