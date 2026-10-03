// tools/flutter/svg-assets.mts
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {FigmaService} from "../../../services/figma.js";
import {join} from 'path';
import {
    createSvgAssetsDirectory,
    generateSvgFilename,
    downloadImage,
    getFileStats,
    updatePubspecAssets,
    type AssetInfo,
    generateSvgAssetConstants
} from "./asset-manager.js";
import {validateAndConvertNodeId} from "../../../utils/figma-url-parser.js";
import {isEffectivelyVisible} from "../../../utils/visibility.js";
import defaults from '../../../defaults.json' with { type: 'json' };

export function registerSvgAssetTools(server: McpServer, figmaApiKey: string) {
    // Tool: Export SVG Flutter Assets
    server.registerTool(
        "export_svg_flutter_assets",
        {
            title: "Export SVG Flutter Assets",
            description: "Export Figma nodes as SVG: exactly the node IDs given, plus descendants whose exportSettings include SVG. Nothing is guessed from a node's contents; hidden nodes are skipped.",
            inputSchema: {
                fileId: z.string().describe("Figma file ID"),
                nodeIds: z.array(z.string()).describe("Array of node IDs to export as SVG; descendants with an SVG export setting are exported too"),
                projectPath: z.string().optional().describe("Path to Flutter project (defaults to current directory)")
            }
        },
        async ({fileId, nodeIds, projectPath = process.cwd()}) => {
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

                nodeIds = nodeIds.map(validateAndConvertNodeId);
                const svgNodes = await selectSvgNodes(fileId, nodeIds, figmaService);

                if (svgNodes.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: "No SVG assets to export: none of the specified nodes is visible. " +
                                  "Hidden nodes (visible: false) and empty slots are skipped."
                        }]
                    };
                }

                // Create SVG assets directory structure
                const assetsDir = await createSvgAssetsDirectory(projectPath);

                let downloadedAssets: AssetInfo[] = [];

                // Export each SVG node
                const imageUrls = await figmaService.getImageExportUrls(fileId, svgNodes.map(n => n.id), {
                    format: 'svg',
                    scale: 1 // SVGs don't need multiple scales
                });

                for (const node of svgNodes) {
                    const imageUrl = imageUrls[node.id];
                    if (!imageUrl) continue;

                    const filename = generateSvgFilename(node.name);
                    const filepath = join(assetsDir, filename);

                    // Download the SVG
                    await downloadImage(imageUrl, filepath);

                    // Get file size for reporting
                    const stats = await getFileStats(filepath);

                    downloadedAssets.push({
                        nodeId: node.id,
                        nodeName: node.name,
                        filename,
                        path: `${defaults.output.svgsDir}/${filename}`,
                        size: stats.size
                    });
                }

                // Constants first: updatePubspecAssets throws on pubspec shapes it refuses to edit
                const constantsFile = await generateSvgAssetConstants(downloadedAssets, projectPath);

                // Update pubspec.yaml with SVG assets
                const pubspecPath = join(projectPath, 'pubspec.yaml');
                await updatePubspecAssets(pubspecPath, downloadedAssets);

                let output = `Successfully exported ${svgNodes.length} SVG assets to Flutter project!\n\n`;
                output += `SVG Assets Directory: ${assetsDir}\n\n`;
                output += `Downloaded SVG Assets:\n`;

                downloadedAssets.forEach(asset => {
                    output += `- ${asset.filename} (${asset.size})\n`;
                });

                output += `\nPubspec Configuration:\n`;
                output += `- Merged SVG asset declarations into pubspec.yaml\n`;
                output += `- SVG assets available under: ${defaults.output.svgsDir}/\n\n`;

                output += `Generated Code:\n`;
                output += `- Merged SVG asset constants into: ${constantsFile}\n`;
                output += `- Import in your Flutter code: import 'package:your_app/constants/svg_assets.dart';\n\n`;

                output += `Usage Note:\n`;
                output += `- Use flutter_svg package to display SVG assets\n`;
                output += `- Add 'flutter_svg: ^2.0.0' to your pubspec.yaml dependencies if not already added\n`;

                return {
                    content: [{type: "text", text: output}]
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error exporting SVG assets: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );
}

/**
 * The nodes to export as SVG: exactly the requested IDs, plus every visible descendant that has an SVG export
 * setting in Figma. Nothing is guessed from the node's contents.
 */
async function selectSvgNodes(fileId: string, targetNodeIds: string[], figmaService: FigmaService): Promise<Array<{id: string, name: string}>> {
    const found = new Map<string, {id: string, name: string}>();
    const visit = (node: any, isRoot: boolean): void => {
        if (!isEffectivelyVisible(node)) return;
        const hasSvgSetting = node.exportSettings?.some((setting: any) => String(setting.format).toUpperCase() === 'SVG');
        if (isRoot || hasSvgSetting) found.set(node.id, {id: node.id, name: node.name});
        node.children?.forEach((child: any) => visit(child, false));
    };
    Object.values(await figmaService.getNodes(fileId, targetNodeIds)).forEach(node => visit(node, true));
    return [...found.values()];
}
