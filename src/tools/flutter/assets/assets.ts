// tools/flutter/assets.mts
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {FigmaService} from "../../../services/figma.js";
import {
    DEVICE_PIXEL_RATIOS,
    devicePixelRatiosInput,
    exportAssetNodes,
    selectAssetNodes
} from "./asset-manager.js";
import {assetUsageReport} from "./asset-report.js";
import {hasPubspec, missingPubspecMessage} from "../../../utils/project-conventions.js";
import {validateAndConvertNodeId} from "../../../utils/figma-url-parser.js";

export function registerFlutterAssetTools(server: McpServer, figmaApiKey: string) {
    // Tool: Export Flutter Assets
    // @ts-ignore TS2589: Known TypeScript limitation with complex Zod schemas in registerTool generics
    server.registerTool(
        "export_flutter_assets",
        {
            title: "Export Flutter Assets",
            description: "Export the given Figma nodes, plus descendants that have exportSettings or a visible IMAGE fill, into the Flutter assets folders and pubspec.yaml. A node's exportSettings give its format and scale (SVG and PDF at 1x; WIDTH/HEIGHT are converted to the nearest ratio of " + DEVICE_PIXEL_RATIOS.join(', ') + "); a node without them is exported in `format` at each of devicePixelRatios.",
            inputSchema: {
                fileId: z.string().describe("Figma file ID"),
                nodeIds: z.array(z.string()).describe("Array of node IDs to export; each is exported, and so are its descendants with exportSettings or a visible IMAGE fill"),
                projectPath: z.string().optional().describe("Path to Flutter project (defaults to current directory)"),
                format: z.enum(['png', 'jpg', 'svg']).optional().describe("Export format for nodes without exportSettings (default: png)"),
                devicePixelRatios: devicePixelRatiosInput
            }
        },
        async ({fileId, nodeIds, projectPath = process.cwd(), format = 'png', devicePixelRatios}) => {
            const token = figmaApiKey;
            if (!token) {
                return {
                    content: [{
                        type: "text",
                        text: "Error: Figma access token not configured."
                    }]
                };
            }

            if (!hasPubspec(projectPath)) {
                return {isError: true, content: [{type: "text", text: missingPubspecMessage(projectPath)}]};
            }

            try {
                const figmaService = new FigmaService(token);

                nodeIds = nodeIds.map(validateAndConvertNodeId);
                const roots = Object.values(await figmaService.getNodes(fileId, nodeIds));
                const imageNodes = selectAssetNodes(roots, true);

                if (imageNodes.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: "No visible nodes to export in the specified IDs. Hidden nodes (visible: false) and empty icon slots are skipped."
                        }]
                    };
                }

                const {assets: downloadedAssets, notes, constants} = await exportAssetNodes({
                    figmaService, fileId, projectPath, nodes: imageNodes, ratios: devicePixelRatios, fallbackFormat: format
                });

                if (downloadedAssets.length === 0) {
                    return {
                        content: [{type: "text", text: `No assets were exported.\n${notes.map(note => `- ${note}\n`).join('')}`}]
                    };
                }

                let output = `Successfully exported ${new Set(downloadedAssets.map(asset => asset.nodeId)).size} assets to Flutter project!\n\n`;
                output += `Downloaded Assets:\n`;
                downloadedAssets.forEach(asset => {
                    output += `  • ${asset.path} (${asset.size})\n`;
                });
                if (notes.length > 0) {
                    output += `\nExport notes:\n${notes.map(note => `- ${note}\n`).join('')}`;
                }

                output += `\n${await assetUsageReport(downloadedAssets, constants, projectPath)}`;

                return {
                    content: [{type: "text", text: output}]
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error exporting assets: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );
}
