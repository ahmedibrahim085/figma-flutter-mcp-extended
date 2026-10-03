// src/tools/flutter/screens/screen-tool.mts

import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {FigmaService} from "../../../services/figma.js";
import {figmaTool} from "../../figma-tool.js";
import {
    ScreenExtractor,
    parseComponentInput,
    type ScreenAnalysis
} from "../../../extractors/screens/index.js";

import {
    generateScreenAnalysisReport,
    generateScreenStructureReport
} from "./helpers.js";

import {
    devicePixelRatiosInput,
    exportAssetNodes,
    selectAssetNodes
} from "../assets/asset-manager.js";
import {analyseAssetSection} from "../assets/asset-report.js";
import {hasPubspec, missingPubspecMessage} from "../../../utils/project-conventions.js";
import {join} from 'path';

export function registerScreenTools(server: McpServer, figmaApiKey: string) {

    // Main screen analysis tool
    server.registerTool(
        "analyze_frame_as_screen",
        {
            title: "Analyze Frame as Screen",
            description: "Analyze a Figma frame treated as a screen to extract layout, child layers, and structure information for Flutter screen implementation",
            inputSchema: {
                input: z.string().describe("Figma frame URL or file ID"),
                nodeId: z.string().optional().describe("Node ID (if providing file ID separately)"),
                extractAssets: z.boolean().optional().describe("Export descendants that have exportSettings or a visible IMAGE fill (default: true)"),
                projectPath: z.string().optional().describe("Path to Flutter project for asset export (defaults to current directory)"),
                devicePixelRatios: devicePixelRatiosInput
            }
        },
        figmaTool('Error analyzing screen', async ({input, nodeId, extractAssets = true, projectPath = process.cwd(), devicePixelRatios}) => {
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
            const screenExtractor = new ScreenExtractor();

            // Get the screen node
            const screenNode = await figmaService.getNode(parsedInput.fileId, parsedInput.nodeId);

            if (!screenNode) {
                return {
                    content: [{
                        type: "text",
                        text: `Screen with node ID "${parsedInput.nodeId}" not found in file.`
                    }]
                };
            }

            // Analyze the screen
            const screenAnalysis = await screenExtractor.analyzeScreen(screenNode);

            // Detect and export screen assets if enabled
            let assetExportInfo = '';
            if (extractAssets) {
                try {
                    if (!hasPubspec(projectPath)) throw new Error(missingPubspecMessage(projectPath));
                    // Descendants only: the analysed frame itself is never exported.
                    const imageNodes = selectAssetNodes(Object.values(await figmaService.getNodes(parsedInput.fileId, [parsedInput.nodeId])), false);
                    if (imageNodes.length > 0) {
                        const exported = await exportAssetNodes({
                            figmaService, fileId: parsedInput.fileId, projectPath, nodes: imageNodes,
                            ratios: devicePixelRatios
                        });
                        assetExportInfo = await analyseAssetSection(exported, projectPath, 'SCREEN ASSET EXPORT');
                    }
                } catch (assetError) {
                    assetExportInfo = `\nAsset Export Warning: ${assetError instanceof Error ? assetError.message : String(assetError)}\n`;
                }
            }

            // Generate analysis report
            const analysisReport = generateScreenAnalysisReport(screenAnalysis, parsedInput);

            return {
                content: [{
                    type: "text",
                    text: analysisReport + assetExportInfo
                }]
            };
        })
    );

    // Screen structure inspection tool
    server.registerTool(
        "inspect_frame_structure",
        {
            title: "Inspect Frame Structure",
            description: "Get a quick overview of a frame's structure and child layers",
            inputSchema: {
                input: z.string().describe("Figma frame URL or file ID"),
                nodeId: z.string().optional().describe("Node ID (if providing file ID separately)"),
                showAllChildren: z.boolean().optional().describe("Include hidden child layers (Figma visible: false) and empty slots (default: false)")
            }
        },
        figmaTool('Error inspecting screen structure', async ({input, nodeId, showAllChildren = false}) => {
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
            const screenNode = await figmaService.getNode(parsedInput.fileId, parsedInput.nodeId);

            if (!screenNode) {
                return {
                    content: [{
                        type: "text",
                        text: `Screen with node ID "${parsedInput.nodeId}" not found.`
                    }]
                };
            }

            const output = generateScreenStructureReport(screenNode, showAllChildren);

            return {
                content: [{type: "text", text: output}]
            };
        })
    );
}

