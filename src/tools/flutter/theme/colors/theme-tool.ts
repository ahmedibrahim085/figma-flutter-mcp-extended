// src/tools/flutter/simple-theme-tool.mts
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {FigmaService} from "../../../../services/figma.js";
import {figmaTool} from "../../../figma-tool.js";
import {extractThemeColors} from "../../../../extractors/colors/index.js";
import {SimpleThemeGenerator, themeConstants} from "./theme-generator.js";
import {describeFill} from "../../../../utils/paint-format.js";
import {convertFillToColorInfo} from "../../../../extractors/components/extractor.js";
import {validateAndConvertNodeId} from "../../../../utils/figma-url-parser.js";
import {join} from 'path';
import {resolveProjectPath, PROJECT_PATH_DESCRIPTION} from '../../../../utils/project-conventions.js';
import defaults from '../../../../defaults.json' with { type: 'json' };

export function registerThemeTools(server: McpServer, figmaApiKey: string) {
    server.registerTool(
        "extract_theme_colors",
        {
            title: "Extract Theme Colors from Frame",
            description: "Extract colors from a Figma frame of color samples with labels",
            inputSchema: {
                fileId: z.string().describe("Figma file ID"),
                nodeId: z.string().describe("Node ID of the frame of color samples"),
                projectPath: z.string().optional().describe(PROJECT_PATH_DESCRIPTION),
                generateThemeData: z.boolean().optional().describe("Generate Flutter ThemeData class (defaults to false)")
            }
        },
        figmaTool('Error extracting theme colors', async ({fileId, nodeId, projectPath: givenPath, generateThemeData = false}) => {
            const projectPath = resolveProjectPath(givenPath);
            // Initialize services
            const figmaService = new FigmaService(figmaApiKey);
            const generator = new SimpleThemeGenerator();

            // Get the specific frame node
            nodeId = validateAndConvertNodeId(nodeId);
            const {document: themeFrame, styles} = await figmaService.getNodeWithStyles(fileId, nodeId);

            if (!themeFrame) {
                return {
                    content: [{
                        type: "text",
                        text: `Frame with node ID "${nodeId}" not found.`
                    }]
                };
            }

            // Extract colors from the frame
            const themeColors = extractThemeColors(themeFrame, styles);

            // A swatch bound to a variable takes the variable's name; Figma only names variables on some plans.
            let variableNamesRefused = false;
            if (themeColors.some(color => color.variableId)) {
                let variableNames: Record<string, string> = {};
                try {
                    variableNames = await figmaService.getLocalVariableNames(fileId);
                } catch {
                    variableNamesRefused = true;
                }
                themeColors.forEach(color => {
                    if (color.variableId) color.name = variableNames[color.variableId] ?? color.variableId;
                });
            }

            if (themeColors.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: `No colors found in frame "${themeFrame.name}". Make sure the frame contains color samples with text labels.`
                    }]
                };
            }

            const constantSet = themeConstants(themeColors);

            // Generate AppColors class
            const outputPath = join(projectPath, 'lib', defaults.output.themeSubdir);
            const generatedFilePath = await generator.generateAppColors(constantSet, outputPath, {
                generateThemeData,
                includeColorScheme: true,
                includeMaterialColors: true
            });

            // Create success report
            let output = `Successfully extracted theme colors!\n\n`;
            output += `Frame: ${themeFrame.name}\n`;
            output += `Node ID: ${nodeId}\n`;
            output += `Colors found: ${themeColors.length}\n`;
            output += `Generated: ${generatedFilePath}\n`;
            if (generateThemeData) {
                output += `Theme Data: ${join(outputPath, defaults.output.themeFile)}\n`;
            }
            output += `\n`;

            output += `Extracted Colors:\n`;
            themeColors.forEach((color, index) => {
                output += `${index + 1}. ${color.name}: ${describeFill(color.fill)}\n`;
            });
            if (variableNamesRefused) {
                output += `\nNote: the variables endpoint refused or failed, so swatches bound to a variable are named by the variable id.\n`;
            }
            const {generated, skipped} = constantSet;
            skipped.forEach(({color, reason}) => {
                output += `\nNote: not generated: "${color.name}" (${describeFill(color.fill)}): ${reason}.\n`;
            });
            const constants = generated.map(({name}) => name);
            if (generateThemeData && !constants.includes('primary')) {
                output += `\nNote: No color named primary: no ColorScheme was generated, only the named colors.\n`;
            }

            output += `\nGenerated Files:\n`;
            output += `• ${defaults.output.colorsFile} - Color constants\n`;
            if (generateThemeData) {
                output += `• ${defaults.output.themeFile} - Flutter ThemeData\n`;
            }

            if (constants.length > 0 || generateThemeData) {
                output += `\nUsage Examples:\n`;
            }
            if (constants.length > 0) {
                output += `// Colors:\n`;
                output += `Container(color: AppColors.${constants[0]})\n`;
                output += `Text('Hello', style: TextStyle(color: AppColors.${constants[constants.length - 1]}))\n`;
            }
            
            if (generateThemeData) {
                output += `\n// Theme:\n`;
                output += `MaterialApp(\n`;
                output += `  theme: AppTheme.lightTheme,\n`;
                output += `  // ... your app\n`;
                output += `)\n`;
            }

            return {
                content: [{type: "text", text: output}]
            };
        })
    );

    // Helper tool to inspect a frame structure
    server.registerTool(
        "inspect_color_frame",
        {
            title: "Inspect Color Frame",
            description: "Inspect the structure of a frame of color samples to understand its contents before extraction",
            inputSchema: {
                fileId: z.string().describe("Figma file ID"),
                nodeId: z.string().describe("Frame node ID to inspect")
            }
        },
        figmaTool('Error inspecting frame', async ({fileId, nodeId}) => {
            const figmaService = new FigmaService(figmaApiKey);
            nodeId = validateAndConvertNodeId(nodeId);
            const frameNode = await figmaService.getNode(fileId, nodeId);

            if (!frameNode) {
                return {
                    content: [{
                        type: "text",
                        text: `Frame with node ID "${nodeId}" not found.`
                    }]
                };
            }

            let output = `Frame Inspection Report\n\n`;
            output += `Frame Name: ${frameNode.name}\n`;
            output += `Frame Type: ${frameNode.type}\n`;
            output += `Node ID: ${nodeId}\n`;
            output += `Children: ${frameNode.children?.length || 0}\n\n`;

            if (frameNode.children && frameNode.children.length > 0) {
                output += `Frame Contents:\n`;
                frameNode.children.forEach((child, index) => {
                    output += `${index + 1}. ${child.name} (${child.type})\n`;

                    // Show color if it has one
                    const solidFill = child.fills?.find(fill => fill.type === 'SOLID' && fill.color && fill.visible !== false);
                    if (solidFill) {
                        output += `   Color: ${describeFill(convertFillToColorInfo(solidFill))}\n`;
                    }

                    // Show text children
                    if (child.children) {
                        const textChildren = child.children.filter(c => c.type === 'TEXT');
                        if (textChildren.length > 0) {
                            output += `   Text: ${textChildren.map(t => t.name).join(', ')}\n`;
                        }
                    }
                });
            } else {
                output += `Frame is empty or has no children.\n`;
            }

            output += `\nThis frame ${frameNode.children && frameNode.children.length > 0 ? 'can' : 'cannot'} be used for theme color extraction.\n`;

            return {
                content: [{type: "text", text: output}]
            };
        })
    );
}
