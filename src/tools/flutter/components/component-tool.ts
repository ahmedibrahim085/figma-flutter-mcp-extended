// src/tools/flutter/component/component-tool.mts

import {WIDGET_SPLIT_ADVICE} from "../../../utils/flutter-guidance.js";
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {FigmaService} from "../../../services/figma.js";
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
import {FlutterStyleLibrary, OptimizationReport} from "../../../extractors/flutter/style-library.js";
import {Logger} from "../../../utils/logger.js";

import {
    generateComponentAnalysisReport,
    generateStructureInspectionReport
} from "./helpers.js";
import {
    generateFlutterImplementation,
    generateComprehensiveDeduplicatedReport,
    generateStyleLibraryReport,
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
                resetCachedStyles: z.boolean().optional().describe("Reset cached styles before analysis (default: false)"),
                devicePixelRatios: devicePixelRatiosInput
            }
        },
        async ({input, nodeId, userDefinedComponent = false, maxChildNodes = 10, includeVariants = true, variantSelection, projectPath = process.cwd(), exportAssets = true, useDeduplication = true, generateFlutterCode = false, resetCachedStyles = false, devicePixelRatios}) => {
            const token = figmaApiKey;
            if (!token) {
                return {
                    content: [{
                        type: "text",
                        text: "Error: Figma access token not configured. Please set FIGMA_API_KEY environment variable."
                    }]
                };
            }

            try {
                // Reset cached styles if requested
                const styleLibrary = FlutterStyleLibrary.getInstance();
                
                if (resetCachedStyles) {
                    styleLibrary.reset();
                }
                
                Logger.info(`🎯 Component Analysis Started:`, {
                    input: input.substring(0, 50) + '...',
                    nodeId,
                    useDeduplication,
                    resetCachedStyles
                });

                // Parse input to get file ID and node ID
                const parsedInput = parseComponentInput(input, nodeId);

                if (!parsedInput.isValid) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error parsing input: ${parsedInput.error || 'Invalid input format'}`
                        }]
                    };
                }

                const figmaService = new FigmaService(token);

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
                const reports: string[] = [];
                let firstDeduplicatedAnalysis: DeduplicatedComponentAnalysis | undefined;

                for (const {variant, node} of targets) {
                    let analysisReport: string;

                    if (useDeduplication) {
                        Logger.info(`🔧 Using enhanced deduplication for component analysis`);
                        const deduplicatedAnalysis: DeduplicatedComponentAnalysis = await deduplicatedExtractor.analyzeComponent(node, true);

                        Logger.info(`📊 Deduplication analysis complete:`, {
                            styleRefs: Object.keys(deduplicatedAnalysis.styleRefs).length,
                            children: deduplicatedAnalysis.children.length,
                            nestedComponents: deduplicatedAnalysis.nestedComponents.length,
                            newStyleDefinitions: deduplicatedAnalysis.newStyleDefinitions ? Object.keys(deduplicatedAnalysis.newStyleDefinitions).length : 0
                        });

                        analysisReport = generateComprehensiveDeduplicatedReport(deduplicatedAnalysis, true);

                        firstDeduplicatedAnalysis ??= deduplicatedAnalysis;

                        if (generateFlutterCode) {
                            analysisReport += "\n\n" + generateFlutterImplementation(deduplicatedAnalysis);
                        }
                    } else {
                        const componentAnalysis: ComponentAnalysis = await componentExtractor.analyzeComponent(node, userDefinedComponent);
                        analysisReport = generateComponentAnalysisReport(componentAnalysis, parsedInput);
                    }

                    reports.push(variant ? `Variant: ${variant.name}${variant.isDefault ? ' (default)' : ''}\n${'─'.repeat(30)}\n${analysisReport}` : analysisReport);
                }

                let analysisReport = variantHeader + reports.join('\n\n');

                // The set's visual context (its URL and node id) is printed once, from the first analysed variant.
                if (firstDeduplicatedAnalysis && parsedInput.source === 'url') {
                    analysisReport += "\n\n" + addVisualContextToDeduplicatedReport(
                        firstDeduplicatedAnalysis,
                        generateFigmaUrl(parsedInput.fileId, parsedInput.nodeId),
                        parsedInput.nodeId
                    );
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

                return {
                    content: [{
                        type: "text",
                        text: analysisReport + assetExportInfo
                    }]
                };

            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error analyzing component: ${error instanceof Error ? error.message : String(error)}`
                    }],
                    isError: true
                };
            }
        }
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
        async ({input, nodeId}) => {
            const token = figmaApiKey;
            if (!token) {
                return {
                    content: [{
                        type: "text",
                        text: "Error: Figma access token not configured."
                    }]
                };
            }

            try {
                const parsedInput = parseComponentInput(input, nodeId);

                if (!parsedInput.isValid) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error parsing input: ${parsedInput.error}`
                        }]
                    };
                }

                const figmaService = new FigmaService(token);
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

            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error listing variants: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );

    // Helper tool to inspect component structure
    server.registerTool(
        "inspect_component_structure",
        {
            title: "Inspect Component Structure",
            description: "Get a quick overview of component structure, children, and nested components. Use inspect_frame_structure for top-level frames.",
            inputSchema: {
                input: z.string().describe("Figma component URL or file ID"),
                nodeId: z.string().optional().describe("Node ID (if providing file ID separately)"),
                userDefinedComponent: z.boolean().optional().describe("Treat a FRAME as a component (when designer hasn't converted to actual component yet) (default: false)"),
                showAllChildren: z.boolean().optional().describe("Show all children regardless of limits (default: false)")
            }
        },
        async ({input, nodeId, userDefinedComponent = false, showAllChildren = false}) => {
            const token = figmaApiKey;
            if (!token) {
                return {
                    content: [{
                        type: "text",
                        text: "Error: Figma access token not configured."
                    }]
                };
            }

            try {
                const parsedInput = parseComponentInput(input, nodeId);

                if (!parsedInput.isValid) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error parsing input: ${parsedInput.error}`
                        }]
                    };
                }

                const figmaService = new FigmaService(token);
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

                const output = generateStructureInspectionReport(componentNode, showAllChildren);

                return {
                    content: [{type: "text", text: output}]
                };

            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error inspecting structure: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );

    // Dedicated Flutter code generation tool
    server.registerTool(
        "generate_flutter_implementation",
        {
            title: "Generate Flutter Implementation",
            description: "Generate complete Flutter widget code using cached style definitions",
            inputSchema: {
                componentNodeId: z.string().describe("Node ID of the analyzed component"),
                includeStyleDefinitions: z.boolean().optional().describe("Include style definitions in output (default: true)"),
                widgetName: z.string().optional().describe("Custom widget class name")
            }
        },
        async ({ componentNodeId, includeStyleDefinitions = true, widgetName }) => {
            try {
                const styleLibrary = FlutterStyleLibrary.getInstance();
                const styles = styleLibrary.getAllStyles();
                
                let output = "🏗️  Flutter Implementation\n";
                output += `${'='.repeat(50)}\n\n`;
                
                if (includeStyleDefinitions && styles.length > 0) {
                    output += "📋 Style Definitions:\n";
                    output += `${'─'.repeat(30)}\n`;
                    styles.forEach(style => {
                        output += `// ${style.id} (${style.category}, used ${style.usageCount} times)\n`;
                        output += `final ${style.id} = ${style.flutterCode};\n\n`;
                    });
                    output += "\n";
                } else if (styles.length === 0) {
                    output += "⚠️  No cached styles found. Please analyze a component first.\n\n";
                }
                
                output += generateWidgetClass(componentNodeId, widgetName || 'CustomWidget', styles);
                
                // Add usage summary
                if (styles.length > 0) {
                    output += "\n\n📊 Cached styles summary:\n";
                    output += `${'─'.repeat(30)}\n`;
                    output += `• Total unique styles: ${styles.length}\n`;
                    
                    const categoryStats = styles.reduce((acc, style) => {
                        acc[style.category] = (acc[style.category] || 0) + 1;
                        return acc;
                    }, {} as Record<string, number>);
                    
                    Object.entries(categoryStats).forEach(([category, count]) => {
                        output += `• ${category}: ${count} style(s)\n`;
                    });
                    
                    const totalUsage = styles.reduce((sum, style) => sum + style.usageCount, 0);
                    output += `• Total style usage: ${totalUsage}\n`;
                    const efficiency = styles.length > 0 ? ((totalUsage - styles.length) / totalUsage * 100).toFixed(1) : '0.0';
                    output += `• Deduplication efficiency: ${efficiency}% reduction\n`;
                }
                
                return {
                    content: [{ type: "text", text: output }]
                };
                
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error generating Flutter implementation: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );

    // Cached styles status tool
    server.registerTool(
        "cached_styles_status",
        {
            title: "Cached Styles Status",
            description: "Get comprehensive status report of the cached styles",
            inputSchema: {}
        },
        async () => {
            try {
                const report = generateStyleLibraryReport();
                
                return {
                    content: [{ type: "text", text: report }]
                };
                
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error generating cached styles report: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );
}


/**
 * Generate widget class implementation
 */
function generateWidgetClass(componentNodeId: string, widgetName: string, styles: Array<any>): string {
    let output = `🎯 Widget Implementation:\n`;
    output += `${'─'.repeat(30)}\n`;
    
    // Widget composition best practices
    output += `🏗️  Widget Composition Guidelines:\n`;
    WIDGET_SPLIT_ADVICE.forEach(line => { output += `- ${line}\n`; });
    output += `\n`;
    
    output += `class ${widgetName} extends StatelessWidget {\n`;
    output += `  const ${widgetName}({Key? key}) : super(key: key);\n\n`;
    output += `  @override\n`;
    output += `  Widget build(BuildContext context) {\n`;

    // Find relevant styles for this component
    const decorationStyles = styles.filter(s => s.category === 'decoration');
    const paddingStyles = styles.filter(s => s.category === 'padding');
    const textStyles = styles.filter(s => s.category === 'text');

    if (decorationStyles.length > 0 || paddingStyles.length > 0) {
        output += `    return Container(\n`;
        
        // Add decoration if available
        if (decorationStyles.length > 0) {
            const decorationStyle = decorationStyles[0]; // Use first decoration style
            output += `      decoration: ${decorationStyle.id},\n`;
        }
        
        // Add padding if available
        if (paddingStyles.length > 0) {
            const paddingStyle = paddingStyles[0]; // Use first padding style
            output += `      padding: ${paddingStyle.id},\n`;
        }
        
        // Add child content
        if (textStyles.length > 0) {
            const textStyle = textStyles[0]; // Use first text style
            output += `      child: Text(\n`;
            output += `        'Sample Text', // TODO: Replace with actual content\n`;
            output += `        style: ${textStyle.id},\n`;
            output += `      ),\n`;
        } else {
            output += `      child: Column(\n`;
            output += `        children: [\n`;
            output += `          // TODO: Add your widget content here\n`;
            output += `          Text('Component Content'),\n`;
            output += `        ],\n`;
            output += `      ),\n`;
        }
        
        output += `    );\n`;
    } else if (textStyles.length > 0) {
        // Just a text widget if only text styles are available
        const textStyle = textStyles[0];
        output += `    return Text(\n`;
        output += `      'Sample Text', // TODO: Replace with actual content\n`;
        output += `      style: ${textStyle.id},\n`;
        output += `    );\n`;
    } else {
        // Fallback for when no cached styles are available
        output += `    return Container(\n`;
        output += `      // TODO: Implement widget using component node ID: ${componentNodeId}\n`;
        output += `      // No cached styles found - please analyze a component first\n`;
        output += `      child: Text('Widget Placeholder'),\n`;
        output += `    );\n`;
    }

    output += `  }\n`;
    output += `}\n`;

    // Add usage instructions
    output += `\n💡 Usage Instructions:\n`;
    output += `${'─'.repeat(30)}\n`;
    WIDGET_SPLIT_ADVICE.forEach((line, index) => { output += `${index + 1}. ${line}\n`; });
    output += `${WIDGET_SPLIT_ADVICE.length + 1}. Replace 'Sample Text' with actual content from Figma\n`;
    output += `${WIDGET_SPLIT_ADVICE.length + 2}. Customize the widget structure and add any missing properties\n\n`;

    if (styles.length > 0) {
        output += `📦 Available Style References:\n`;
        output += `${'─'.repeat(30)}\n`;
        styles.forEach(style => {
            output += `• ${style.id} (${style.category})\n`;
        });
    }

    return output;
}
