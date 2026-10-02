// src/extractors/components/variant-analyzer.mts

import type {FigmaNode} from '../../types/figma.js';
import type {ComponentVariant, VariantAxis} from './types.js';

/**
 * Variant analysis for ComponentSets
 */
export class VariantAnalyzer {

    /**
     * Analyze component set and extract all variants
     */
    async analyzeComponentSet(componentSetNode: FigmaNode): Promise<ComponentVariant[]> {
        if (componentSetNode.type !== 'COMPONENT_SET') {
            throw new Error('Node is not a COMPONENT_SET');
        }

        const variants: ComponentVariant[] = [];

        if (!componentSetNode.children || componentSetNode.children.length === 0) {
            return variants;
        }

        // Process each variant (child component)
        componentSetNode.children.forEach(child => {
            if (child.type === 'COMPONENT') {
                const variant = this.extractVariantInfo(child);
                variants.push(variant);
            }
        });

        // The default variant is the one whose values equal every axis's Figma default.
        const axes = this.getVariantAxes(componentSetNode);
        variants.forEach(variant => {
            variant.isDefault = axes.length > 0 && axes.every(axis => variant.properties[axis.name] === axis.defaultValue);
        });

        return variants;
    }

    /**
     * Extract variant information from a component node
     */
    private extractVariantInfo(componentNode: FigmaNode): ComponentVariant {
        return {
            nodeId: componentNode.id,
            name: componentNode.name,
            properties: this.parseVariantProperties(componentNode.name),
            isDefault: false // Set from the axes' Figma defaults in analyzeComponentSet
        };
    }

    /**
     * Parse variant properties from component name
     * Figma variant names are typically in format: "Property=Value, Property2=Value2"
     */
    private parseVariantProperties(componentName: string): Record<string, string> {
        const properties: Record<string, string> = {};

        try {
            // Split by comma to get individual property=value pairs
            const pairs = componentName.split(',').map(pair => pair.trim());

            pairs.forEach(pair => {
                const [property, value] = pair.split('=').map(str => str.trim());
                if (property && value) {
                    properties[property] = value;
                }
            });

            // If no properties found, treat the whole name as a single property
            if (Object.keys(properties).length === 0) {
                properties['variant'] = componentName;
            }

        } catch (error) {
            // Fallback: treat component name as single variant property
            properties['variant'] = componentName;
        }

        return properties;
    }

    /**
     * The VARIANT entries of the set's componentPropertyDefinitions, in Figma's order.
     */
    getVariantAxes(componentSetNode: FigmaNode): VariantAxis[] {
        return Object.entries(componentSetNode.componentPropertyDefinitions ?? {})
            .filter(([, definition]) => definition.type === 'VARIANT')
            .map(([name, definition]) => ({
                name,
                options: definition.variantOptions ?? [],
                defaultValue: String(definition.defaultValue ?? '')
            }));
    }

    /**
     * Filter variants by user selection criteria
     */
    filterVariantsBySelection(
        variants: ComponentVariant[],
        selection: {
            variantNames?: string[];
            properties?: Record<string, string>;
            includeDefault?: boolean;
        }
    ): ComponentVariant[] {
        let filtered = variants;

        // Filter by variant names if specified
        if (selection.variantNames && selection.variantNames.length > 0) {
            filtered = filtered.filter(variant =>
                selection.variantNames!.some(name =>
                    variant.name.toLowerCase().includes(name.toLowerCase())
                )
            );
        }

        // Filter by specific properties if specified
        if (selection.properties && Object.keys(selection.properties).length > 0) {
            filtered = filtered.filter(variant => {
                return Object.entries(selection.properties!).every(([key, value]) => {
                    return variant.properties[key] &&
                        variant.properties[key].toLowerCase() === value.toLowerCase();
                });
            });
        }

        // Include default if requested
        if (selection.includeDefault) {
            const defaultVariant = variants.find(v => v.isDefault);
            if (defaultVariant && !filtered.includes(defaultVariant)) {
                filtered.push(defaultVariant);
            }
        }

        return filtered;
    }

    /**
     * Generate summary of variant analysis: the variants, then the axes and defaults Figma defines
     */
    generateVariantSummary(variants: ComponentVariant[], axes: VariantAxis[]): string {
        if (variants.length === 0) {
            return 'No variants found in component set.';
        }

        let summary = `Found ${variants.length} variants:\n`;
        variants.forEach((variant, index) => {
            const defaultMark = variant.isDefault ? ' (default)' : '';
            summary += `${index + 1}. ${variant.name}${defaultMark}\n`;
        });

        if (axes.length > 0) {
            summary += '\nVariant axes (Figma componentPropertyDefinitions):\n';
            axes.forEach(axis => {
                summary += `- ${axis.name}: ${axis.options.join(', ')} (default: ${axis.defaultValue})\n`;
            });
        }

        if (!variants.some(variant => variant.isDefault)) {
            summary += axes.length > 0
                ? "\nFigma's defaults match no variant; none is marked default.\n"
                : '\nThis set has no VARIANT property definitions; no default variant is marked.\n';
        }

        return summary;
    }
}
