// src/tools/flutter/typography-tool.mts

import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {FigmaService} from "../../../../services/figma.js";
import {extractThemeTypography} from "../../../../extractors/typography/index.js";
import {TypographyGenerator, typographyConstants} from "./typography-generator.js";
import {join} from 'path';
import {validateAndConvertNodeId} from "../../../../utils/figma-url-parser.js";
import defaults from '../../../../defaults.json' with { type: 'json' };

export function registerTypographyTools(server: McpServer, figmaApiKey: string) {
    server.registerTool(
        "extract_theme_typography",
        {
            title: "Extract Theme Typography from Frame",
            description: "Extract typography styles from a Figma frame of text samples with different styles",
            inputSchema: {
                fileId: z.string().describe("Figma file ID"),
                nodeId: z.string().describe("Node ID of the frame of text samples"),
                projectPath: z.string().optional().describe("Path to Flutter project (defaults to current directory)"),
                generateTextTheme: z.boolean().optional().describe("Generate Flutter TextTheme class (defaults to false)")
            }
        },
        async ({fileId, nodeId, projectPath = process.cwd(), generateTextTheme = false}) => {
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
                // Initialize services
                const figmaService = new FigmaService(token);
                const generator = new TypographyGenerator();

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

                // Extract typography from the frame
                const themeTypography = extractThemeTypography(themeFrame, styles);

                if (themeTypography.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: `No typography styles found in frame "${themeFrame.name}". Make sure the frame contains text nodes with different styles.`
                        }]
                    };
                }

                // Generate AppText class
                const constantSet = typographyConstants(themeTypography);
                const outputPath = join(projectPath, 'lib', defaults.output.themeSubdir);
                const generatedFilePath = await generator.generateAppText(constantSet, outputPath, generateTextTheme);
                const textThemeWritten = generateTextTheme && constantSet.slots.length > 0;

                // Create success report
                let output = `Successfully extracted theme typography!\n\n`;
                output += `Frame: ${themeFrame.name}\n`;
                output += `Node ID: ${nodeId}\n`;
                output += `Typography styles found: ${themeTypography.length}\n`;
                output += `Generated: ${generatedFilePath}\n`;
                if (textThemeWritten) {
                    output += `Text Theme: ${join(outputPath, defaults.output.textThemeFile)}\n`;
                }
                output += `\n`;

                output += `Extracted Typography Styles:\n`;
                themeTypography.forEach((style, index) => {
                    const {fields} = style;
                    output += `${index + 1}. ${style.name}:\n`;
                    output += `   Font: ${fields.fontFamily ?? 'not set by Figma'}\n`;
                    output += `   Size: ${fields.fontSize === undefined ? 'not set by Figma' : `${fields.fontSize}px`}\n`;
                    output += `   Weight: ${fields.fontWeight ?? 'not set by Figma'}\n`;
                    output += `   Height: ${fields.height ?? 'not set by Figma'}\n`;
                    output += `   Letter Spacing: ${fields.letterSpacing}px\n`;
                    if (style.unsupported.length > 0) {
                        output += `   Not in a Flutter TextStyle: ${style.unsupported.join(', ')}\n`;
                    }
                    output += `\n`;
                });
                constantSet.skipped.forEach(({style, reason}) => {
                    output += `Note: not generated: "${style.name}": ${reason}.\n`;
                });
                constantSet.slotClashes.forEach(({slot, styles: clashing}) => {
                    output += `Note: ${clashing.map(style => `"${style.name}"`).join(' and ')} both equal the TextTheme slot ${slot}: not filled.\n`;
                });
                if (generateTextTheme) {
                    if (constantSet.slots.length === 0) {
                        output += `Note: No style name equals a TextTheme slot: no TextTheme was generated.\n`;
                    }
                    const unfilled = defaults.textThemeSlots.filter(slot => !constantSet.slots.some(filled => filled.slot === slot));
                    if (unfilled.length > 0) {
                        output += `Unfilled TextTheme slots: ${unfilled.join(', ')}\n`;
                    }
                }

                output += `\nGenerated Files:\n`;
                output += `• ${defaults.output.textStylesFile} - Typography style constants\n`;
                if (textThemeWritten) {
                    output += `• ${defaults.output.textThemeFile} - Material Design TextTheme\n`;
                }

                output += `\nUsage Examples:\n`;
                if (constantSet.generated.length > 0) {
                    output += `// Typography:\n`;
                    output += `Text('Hello World', style: AppText.${constantSet.generated[0].name})\n`;
                }

                if (textThemeWritten) {
                    output += `\n// Material Design Theme:\n`;
                    output += `MaterialApp(\n`;
                    output += `  theme: ThemeData(\n`;
                    output += `    textTheme: AppTextTheme.textTheme,\n`;
                    output += `  ),\n`;
                    output += `  // ... your app\n`;
                    output += `)\n`;
                }

                return {
                    content: [{type: "text", text: output}]
                };

            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error extracting theme typography: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );

    // Helper tool to inspect a frame structure for typography
    server.registerTool(
        "inspect_text_style_frame",
        {
            title: "Inspect Text Style Frame",
            description: "Inspect the structure of a frame of text samples to understand its text contents before extraction",
            inputSchema: {
                fileId: z.string().describe("Figma file ID"),
                nodeId: z.string().describe("Frame node ID to inspect")
            }
        },
        async ({fileId, nodeId}) => {
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
                const figmaService = new FigmaService(token);
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

                let output = `Text Style Frame Inspection Report\n\n`;
                output += `Frame Name: ${frameNode.name}\n`;
                output += `Frame Type: ${frameNode.type}\n`;
                output += `Node ID: ${nodeId}\n`;
                output += `Children: ${frameNode.children?.length || 0}\n\n`;

                if (frameNode.children && frameNode.children.length > 0) {
                    output += `Frame Contents:\n`;
                    let textNodesFound = 0;
                    
                    frameNode.children.forEach((child, index) => {
                        output += `${index + 1}. ${child.name} (${child.type})\n`;

                        // Show text style if it has one
                        if (child.type === 'TEXT' && child.style) {
                            textNodesFound++;
                            output += `   Font: ${child.style.fontFamily ?? 'not set by Figma'}\n`;
                            output += `   Size: ${child.style.fontSize === undefined ? 'not set by Figma' : `${child.style.fontSize}px`}\n`;
                            output += `   Weight: ${child.style.fontWeight ?? 'not set by Figma'}\n`;
                            if (child.style.lineHeightPx !== undefined) {
                                output += `   Line Height: ${child.style.lineHeightPx}px\n`;
                            }
                            if (child.style.letterSpacing !== undefined) {
                                output += `   Letter Spacing: ${child.style.letterSpacing}px\n`;
                            }
                        }

                        // Check for nested text nodes
                        if (child.children) {
                            const nestedTextNodes = findTextNodes(child);
                            if (nestedTextNodes.length > 0) {
                                textNodesFound += nestedTextNodes.length;
                                output += `   Contains ${nestedTextNodes.length} text node(s)\n`;
                            }
                        }
                    });

                    output += `\nText nodes found: ${textNodesFound}\n`;
                } else {
                    output += `Frame is empty or has no children.\n`;
                }

                const canExtract = frameNode.children && frameNode.children.some(child => 
                    child.type === 'TEXT' || (child.children && findTextNodes(child).length > 0)
                );

                output += `\nThis frame ${canExtract ? 'can' : 'cannot'} be used for typography extraction.\n`;

                return {
                    content: [{type: "text", text: output}]
                };

            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error inspecting frame: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );
}

// Helper method to find text nodes recursively
function findTextNodes(node: any): any[] {
    const textNodes: any[] = [];
    
    if (node.type === 'TEXT') {
        textNodes.push(node);
    }
    
    if (node.children) {
        node.children.forEach((child: any) => {
            textNodes.push(...findTextNodes(child));
        });
    }
    
    return textNodes;
}
