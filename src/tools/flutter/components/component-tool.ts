// src/tools/flutter/component/component-tool.mts

import defaults from '../../../defaults.json' with { type: 'json' };
import {budgetNote, countNodes, cutTree, newCut, renderWithinBudget, type Cut} from '../../../utils/budget.js';
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {FigmaService} from "../../../services/figma.js";
import {figmaTool} from "../../figma-tool.js";
import {
    ComponentExtractor,
    VariantAnalyzer,
    parseComponentInput,
    type ComponentAnalysis,
    type ComponentVariant,
    DeduplicatedComponentExtractor,
    type DeduplicatedComponentAnalysis
} from "../../../extractors/components/index.js";
import {generateFigmaUrl} from "../../../utils/figma-url-parser.js";
import {OptimizationReport} from "../../../extractors/flutter/style-library.js";
import {Logger} from "../../../utils/logger.js";
import {typeName} from "../../../utils/dart-names.js";

import {
    generateComponentAnalysisReport,
    generateStructureInspectionReport,
    inspectedChildren
} from "./helpers.js";
import {
    generateFlutterImplementation,
    styleDefinitionsSection,
    generateComprehensiveDeduplicatedReport,
    addVisualContextToDeduplicatedReport
} from "./deduplicated-helpers.js";

import {
    devicePixelRatiosInput,
    exportAssetNodes,
    selectAssetNodes
} from "../assets/asset-manager.js";
import {analyseAssetSection} from "../assets/asset-report.js";
import {hasPubspec, missingPubspecMessage} from "../../../utils/project-conventions.js";
import {join} from 'path';

export function registerComponentTools(server: McpServer, figmaApiKey: string) {

    // Main component analysis tool
    // @ts-ignore TS2589: Known TypeScript limitation with complex Zod schemas in registerTool generics
    server.registerTool(
        "analyze_figma_component",
        {
            _meta: {'anthropic/maxResultSizeChars': defaults.maxResultSizeChars},
            title: "Analyze Figma Component",
            description: "Analyze a Figma component or component set to extract layout, styling, and structure information for Flutter widget creation. Use analyze_frame_as_screen for top-level frames.",
            inputSchema: {
                input: z.string().describe("Figma component URL or file ID"),
                nodeId: z.string().optional().describe("Node ID (if providing file ID separately)"),
                userDefinedComponent: z.boolean().optional().describe("Treat a FRAME as a component (when designer hasn't converted to actual component yet) (default: false)"),
                maxChildNodes: z.number().optional().describe("Maximum child nodes to analyze (default: 10)"),
                includeVariants: z.boolean().optional().describe("Include variant analysis for component sets (default: true)"),
                variantSelection: z.array(z.string()).optional().describe("Variant names to analyze instead of every variant of a component set"),
                projectPath: z.string().optional().describe("Path to Flutter project for asset export (defaults to current directory)"),
                exportAssets: z.boolean().optional().describe("Export descendants that have exportSettings or a visible IMAGE fill (default: true)"),
                useDeduplication: z.boolean().optional().describe("Use style deduplication for token efficiency (default: true)"),
                generateFlutterCode: z.boolean().optional().describe("Generate full Flutter implementation code (default: false)"),
                devicePixelRatios: devicePixelRatiosInput
            }
        },
        figmaTool('Error analyzing component', async ({input, nodeId, userDefinedComponent = false, maxChildNodes = 10, includeVariants = true, variantSelection, projectPath = process.cwd(), exportAssets = true, useDeduplication = true, generateFlutterCode = false, devicePixelRatios}) => {
            Logger.info(`🎯 Component Analysis Started:`, {
                input: input.substring(0, 50) + '...',
                nodeId,
                useDeduplication
            });

            // Parse input to get file ID and node ID
            const parsedInput = parseComponentInput(input, nodeId);

            if (!parsedInput.isValid) {
                return {
                    isError: true,
                    content: [{
                        type: "text",
                        text: `Error parsing input: ${parsedInput.error || 'Invalid input format'}`
                    }]
                };
            }

            const figmaService = new FigmaService(figmaApiKey);

            // Get the component node
            const componentNode = await figmaService.getNode(parsedInput.fileId, parsedInput.nodeId);

            if (!componentNode) {
                return {
                    content: [{
                        type: "text",
                        text: `Component with node ID "${parsedInput.nodeId}" not found in file.`
                    }]
                };
            }

            // Validate that this is a component or user-defined component
            const isActualComponent = componentNode.type === 'COMPONENT' || componentNode.type === 'COMPONENT_SET' || componentNode.type === 'INSTANCE';
            const isUserDefinedFrame = componentNode.type === 'FRAME' && userDefinedComponent;
            
            if (!isActualComponent && !isUserDefinedFrame) {
                if (componentNode.type === 'FRAME') {
                    return {
                        content: [{
                            type: "text",
                            text: `Node "${componentNode.name}" is a FRAME. If this should be treated as a component, set userDefinedComponent: true. For analyzing top-level frames, use the analyze_frame_as_screen tool instead.`
                        }]
                    };
                } else {
                    return {
                        content: [{
                            type: "text",
                            text: `Node "${componentNode.name}" is not a component (type: ${componentNode.type}). For analyzing top-level frames, use the analyze_frame_as_screen tool instead.`
                        }]
                    };
                }
            }

            // A component set is analysed whole: every variant (or the ones variantSelection names),
            // taken from the set response, with the axes and defaults Figma defines.
            let selectedVariants: ComponentVariant[] = [];
            let variantHeader = '';

            if (componentNode.type === 'COMPONENT_SET' && includeVariants) {
                const variantAnalyzer = new VariantAnalyzer();
                const variantAnalysis = await variantAnalyzer.analyzeComponentSet(componentNode);
                selectedVariants = variantAnalysis;

                if (variantSelection && variantSelection.length > 0) {
                    if (variantAnalyzer.filterVariantsBySelection(variantAnalysis, {variantNames: variantSelection}).length === 0) {
                        return {
                            content: [{
                                type: "text",
                                text: `No variant matches the selection (${variantSelection.join(', ')}). Variants: ${variantAnalysis.map(variant => variant.name).join('; ')}`
                            }]
                        };
                    }
                    selectedVariants = variantAnalyzer.filterVariantsBySelection(variantAnalysis, {variantNames: variantSelection, includeDefault: true});
                }

                variantHeader = `Component Set: ${componentNode.name}\n\n`
                    + `${variantAnalyzer.generateVariantSummary(variantAnalysis, variantAnalyzer.getVariantAxes(componentNode))}\n`
                    + `Analyzed variants (${selectedVariants.length} of ${variantAnalysis.length}):\n`
                    + selectedVariants.map(variant => `- ${variant.name}${variant.isDefault ? ' (default)' : ''}\n`).join('')
                    + `\n`;
            }

            // Analyse each variant node, or the node itself when there are none.
            const targets: Array<{variant?: ComponentVariant; node: typeof componentNode}> = selectedVariants.length > 0
                ? selectedVariants.map(variant => ({variant, node: componentNode.children!.find(child => child.id === variant.nodeId)!}))
                : [{node: componentNode}];
            const deduplicatedExtractor = new DeduplicatedComponentExtractor();
            const componentExtractor = new ComponentExtractor({
                maxChildNodes,
                extractTextContent: true
            });
            // Each report is built for a cut (see render below), so one that is too long can drop nodes in document order.
            const reports: Array<(cut: Cut) => string> = [];
            let analysedNodes = 0;
            let firstDeduplicatedAnalysis: DeduplicatedComponentAnalysis | undefined;

            for (const {variant, node} of targets) {
                if (useDeduplication) {
                    Logger.info(`🔧 Using enhanced deduplication for component analysis`);
                    const deduplicatedAnalysis: DeduplicatedComponentAnalysis = await deduplicatedExtractor.analyzeComponent(node, true);

                    Logger.info(`📊 Deduplication analysis complete:`, {
                        styleRefs: Object.keys(deduplicatedAnalysis.styleRefs).length,
                        children: deduplicatedAnalysis.children.length,
                        nestedComponents: deduplicatedAnalysis.nestedComponents.length,
                        newStyleDefinitions: deduplicatedAnalysis.newStyleDefinitions ? Object.keys(deduplicatedAnalysis.newStyleDefinitions).length : 0
                    });

                    firstDeduplicatedAnalysis ??= deduplicatedAnalysis;
                    analysedNodes += countNodes(deduplicatedAnalysis.children);
                    const styleLibrary = deduplicatedExtractor.styleLibrary;
                    reports.push((cut) => {
                        const analysed = {...deduplicatedAnalysis, children: cutTree(deduplicatedAnalysis.children, cut)};
                        let analysisReport = generateComprehensiveDeduplicatedReport(analysed, styleLibrary, true);
                        if (generateFlutterCode) {
                            const implementation = generateFlutterImplementation(analysed, styleLibrary);
                            analysisReport += "\n\n" + styleDefinitionsSection(implementation, styleLibrary) + implementation;
                        }
                        return variant ? `Variant: ${variant.name}${variant.isDefault ? ' (default)' : ''}\n${'─'.repeat(30)}\n${analysisReport}` : analysisReport;
                    });
                } else {
                    const componentAnalysis: ComponentAnalysis = await componentExtractor.analyzeComponent(node, userDefinedComponent);
                    const analysisReport = generateComponentAnalysisReport(componentAnalysis, parsedInput);
                    reports.push(() => variant ? `Variant: ${variant.name}${variant.isDefault ? ' (default)' : ''}\n${'─'.repeat(30)}\n${analysisReport}` : analysisReport);
                }
            }

            // Detect and export image assets if enabled
            let assetExportInfo = '';
            if (exportAssets) {
                try {
                    if (!hasPubspec(projectPath)) throw new Error(missingPubspecMessage(projectPath));
                    // Descendants only: the analysed component itself is never exported.
                    const imageNodes = selectAssetNodes(Object.values(await figmaService.getNodes(parsedInput.fileId, [parsedInput.nodeId])), false);
                    if (imageNodes.length > 0) {
                        const exported = await exportAssetNodes({
                            figmaService, fileId: parsedInput.fileId, projectPath, nodes: imageNodes,
                            ratios: devicePixelRatios
                        });
                        assetExportInfo = await analyseAssetSection(exported, projectPath, 'AUTOMATIC ASSET EXPORT');
                    }
                } catch (assetError) {
                    assetExportInfo = `\nAsset Export Warning: ${assetError instanceof Error ? assetError.message : String(assetError)}\n`;
                }
            }

            // Over the response budget the tree is cut at whole nodes in document order; the cut nodes' ids end the text.
            const render = (limit: number) => {
                const cut = newCut(limit);
                let analysisReport = variantHeader + reports.map(report => report(cut)).join('\n\n');

                // The set's visual context (its URL and node id) is printed once, from the first analysed variant.
                if (firstDeduplicatedAnalysis && parsedInput.source === 'url') {
                    analysisReport += "\n\n" + addVisualContextToDeduplicatedReport(
                        firstDeduplicatedAnalysis,
                        generateFigmaUrl(parsedInput.fileId, parsedInput.nodeId),
                        parsedInput.nodeId
                    );
                }
                return analysisReport + assetExportInfo + budgetNote(cut.omitted);
            };

            return {
                content: [{
                    type: "text",
                    text: renderWithinBudget(analysedNodes, render, 0)
                }]
            };
        })
    );

    // Helper tool to list component variants
    server.registerTool(
        "list_component_variants",
        {
            title: "List Component Variants",
            description: "List the variants of a Figma component set with the variant axes and defaults Figma defines",
            inputSchema: {
                input: z.string().describe("Figma component set URL or file ID"),
                nodeId: z.string().optional().describe("Node ID (if providing file ID separately)")
            }
        },
        figmaTool('Error listing variants', async ({input, nodeId}) => {
            const parsedInput = parseComponentInput(input, nodeId);

            if (!parsedInput.isValid) {
                return {
                    isError: true,
                    content: [{
                        type: "text",
                        text: `Error parsing input: ${parsedInput.error}`
                    }]
                };
            }

            const figmaService = new FigmaService(figmaApiKey);
            const componentNode = await figmaService.getNode(parsedInput.fileId, parsedInput.nodeId);

            if (!componentNode) {
                return {
                    content: [{
                        type: "text",
                        text: `Component set with node ID "${parsedInput.nodeId}" not found.`
                    }]
                };
            }

            if (componentNode.type !== 'COMPONENT_SET') {
                return {
                    content: [{
                        type: "text",
                        text: `Node "${componentNode.name}" is not a component set (type: ${componentNode.type}). This tool is only for component sets with variants.`
                    }]
                };
            }

            const variantAnalyzer = new VariantAnalyzer();
            const variants = await variantAnalyzer.analyzeComponentSet(componentNode);
            const summary = variantAnalyzer.generateVariantSummary(variants, variantAnalyzer.getVariantAxes(componentNode));

            const output = `Component Set: ${componentNode.name}\n\n${summary}\n`;

            return {
                content: [{type: "text", text: output}]
            };
        })
    );

    // Helper tool to inspect component structure
    server.registerTool(
        "inspect_component_structure",
        {
            _meta: {'anthropic/maxResultSizeChars': defaults.maxResultSizeChars},
            title: "Inspect Component Structure",
            description: "Get a quick overview of component structure, children, and nested components. Use inspect_frame_structure for top-level frames.",
            inputSchema: {
                input: z.string().describe("Figma component URL or file ID"),
                nodeId: z.string().optional().describe("Node ID (if providing file ID separately)"),
                userDefinedComponent: z.boolean().optional().describe("Treat a FRAME as a component (when designer hasn't converted to actual component yet) (default: false)"),
                showAllChildren: z.boolean().optional().describe("Include hidden child layers (Figma visible: false) and empty slots (default: false)")
            }
        },
        figmaTool('Error inspecting structure', async ({input, nodeId, userDefinedComponent = false, showAllChildren = false}) => {
            const parsedInput = parseComponentInput(input, nodeId);

            if (!parsedInput.isValid) {
                return {
                    isError: true,
                    content: [{
                        type: "text",
                        text: `Error parsing input: ${parsedInput.error}`
                    }]
                };
            }

            const figmaService = new FigmaService(figmaApiKey);
            const componentNode = await figmaService.getNode(parsedInput.fileId, parsedInput.nodeId);

            if (!componentNode) {
                return {
                    content: [{
                        type: "text",
                        text: `Component with node ID "${parsedInput.nodeId}" not found.`
                    }]
                };
            }

            // Validate that this is a component or user-defined component
            const isActualComponent = componentNode.type === 'COMPONENT' || componentNode.type === 'COMPONENT_SET' || componentNode.type === 'INSTANCE';
            const isUserDefinedFrame = componentNode.type === 'FRAME' && userDefinedComponent;
            
            if (!isActualComponent && !isUserDefinedFrame) {
                if (componentNode.type === 'FRAME') {
                    return {
                        content: [{
                            type: "text",
                            text: `Node "${componentNode.name}" is a FRAME. If this should be treated as a component, set userDefinedComponent: true. For inspecting top-level frames, use the inspect_frame_structure tool instead.`
                        }]
                    };
                } else {
                    return {
                        content: [{
                            type: "text",
                            text: `Node "${componentNode.name}" is not a component (type: ${componentNode.type}). For inspecting top-level frames, use the inspect_frame_structure tool instead.`
                        }]
                    };
                }
            }

            const output = renderWithinBudget(inspectedChildren(componentNode, showAllChildren).length,
                (limit) => generateStructureInspectionReport(componentNode, showAllChildren, limit), 0);

            return {
                content: [{type: "text", text: output}]
            };
        })
    );

    // Dedicated Flutter code generation tool
    server.registerTool(
        "generate_flutter_implementation",
        {
            _meta: {'anthropic/maxResultSizeChars': defaults.maxResultSizeChars},
            title: "Generate Flutter Implementation",
            description: "Generate complete Flutter widget code for one Figma node, with the style definitions it uses",
            inputSchema: {
                input: z.string().describe("Figma node URL or file ID"),
                nodeId: z.string().optional().describe("Node ID (if providing file ID separately)"),
                includeStyleDefinitions: z.boolean().optional().describe("Include style definitions in output (default: true)"),
                widgetName: z.string().optional().describe("Custom widget class name")
            }
        },
        figmaTool('Error generating Flutter implementation', async ({ input, nodeId, includeStyleDefinitions = true, widgetName }) => {
            const parsedInput = parseComponentInput(input, nodeId);
            if (!parsedInput.isValid) {
                return {
                    content: [{type: "text", text: `Error parsing input: ${parsedInput.error || 'Invalid input format'}`}],
                    isError: true
                };
            }
            const {document: node, componentSetName} = await new FigmaService(figmaApiKey).getNodeWithStyles(parsedInput.fileId, parsedInput.nodeId);
            const extractor = new DeduplicatedComponentExtractor();
            // A component set gives one class per variant, named from the set name and the variant name.
            const classes: Array<{analysis: DeduplicatedComponentAnalysis; className?: string}> = node.type === 'COMPONENT_SET'
                ? await Promise.all((node.children ?? []).filter(variant => variant.type === 'COMPONENT').map(async variant =>
                    ({analysis: await extractor.analyzeComponent(variant, true), className: typeName(`${widgetName ?? node.name} ${variant.name}`)})))
                : [{analysis: await extractor.analyzeComponent(node, true),
                    // A variant passed on its own is named as it is through its set: set name plus variant name.
                    className: componentSetName ? typeName(`${widgetName ?? componentSetName} ${node.name}`) : widgetName}];

            // Over the response budget the tree is cut at whole nodes, in document order; each cut node is a placeholder
            // in the code and its id is listed, so the code still compiles and the caller can ask for that node.
            const render = (limit: number) => {
                const cut = newCut(limit);
                const implementation = classes.map(({analysis, className}) =>
                    generateFlutterImplementation({...analysis, children: cutTree(analysis.children, cut)}, extractor.styleLibrary, className)).join('\n');
                let output = "🏗️  Flutter Implementation\n";
                output += `${'='.repeat(50)}\n\n`;
                if (includeStyleDefinitions) output += styleDefinitionsSection(implementation, extractor.styleLibrary);
                return output + implementation + budgetNote(cut.omitted);
            };
            const text = renderWithinBudget(classes.reduce((total, {analysis}) => total + countNodes(analysis.children), 0), render, 0);

            return {
                content: [{ type: "text", text }]
            };
        })
    );
}

