// src/tools/figma-core/core-tools.ts
// Drop-in replacements for the official Figma MCP tools (get_metadata, get_screenshot,
// get_design_context, get_variable_defs) that call the REST API directly via personal
// access token — bypassing the official MCP server's 200/day rate limit.

import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {FigmaService, ImageDownloadError, type ImageOptions} from '../../services/figma.js';
import {FigmaError, FigmaNotFoundError} from '../../types/errors.js';
import {figmaTool} from '../figma-tool.js';
import {Logger} from '../../utils/logger.js';
import defaults from '../../defaults.json' with { type: 'json' };
import {BUDGET_META, countNodes, renderWithinBudget} from '../../utils/budget.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** What one response includes: the first `limit` nodes in document order. */
interface Cut {
    limit: number;
    included: number;
    /** Root of each omitted subtree, in document order. */
    omitted: string[];
    /** FRAME/COMPONENT/COMPONENT_SET among the included nodes. */
    frames: any[];
}

/** Recursively summarise a node tree (id, name, type, children count, bounding box), stopping at the cut. */
function summariseNode(node: any, cut: Cut): any {
    cut.included++;
    const summary: any = {
        id: node.id,
        name: node.name,
        type: node.type,
    };
    if (node.absoluteBoundingBox) {
        summary.bounds = node.absoluteBoundingBox;
    }
    if (node.characters) {
        summary.text = node.characters;
    }
    if (node.visible === false) {
        summary.visible = false;
    }
    if (['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(node.type)) {
        cut.frames.push({
            id: node.id,
            name: node.name,
            type: node.type,
            width: node.absoluteBoundingBox?.width,
            height: node.absoluteBoundingBox?.height,
        });
    }
    if (node.children) {
        summary.childCount = node.children.length;
        summary.children = [];
        for (const child of node.children) {
            if (cut.included < cut.limit) summary.children.push(summariseNode(child, cut));
            else cut.omitted.push(child.id);
        }
    }
    return summary;
}

/**
 * Serialises `build(tree, frames)` for `root`. Over the budget, it keeps the
 * most nodes (in document order) that fit and adds `truncated` and
 * `omittedNodeIds`, so the text stays valid JSON.
 */
function renderTree(root: any, build: (tree: any, frames: any[]) => any): string {
    const render = (limit: number) => {
        const cut: Cut = {limit, included: 0, omitted: [], frames: []};
        const result = build(summariseNode(root, cut), cut.frames);
        if (cut.omitted.length > 0) {
            result.truncated = true;
            result.omittedNodeIds = cut.omitted;
        }
        return JSON.stringify(result, null, 2);
    };
    return renderWithinBudget(countNodes([root]), render);
}

// ────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────

export function registerCoreTools(server: McpServer, figmaApiKey: string) {
    const figma = new FigmaService(figmaApiKey);

    // ── ff_get_metadata ──────────────────────────────────────
    server.registerTool(
        'ff_get_metadata',
        {
            _meta: BUDGET_META,
            title: 'Get Figma File Metadata',
            description:
                'Get the node tree structure of a Figma file or a specific node. ' +
                'Returns page/frame hierarchy with IDs, names, types, and bounding boxes. ' +
                'Use this to discover all top-level frames before extracting individual ones.',
            inputSchema: {
                fileKey: z.string().describe('Figma file key (from the URL)'),
                nodeId: z
                    .string()
                    .optional()
                    .describe('Optional node ID to scope the tree (e.g. "12:86"). Omit for full file.'),
                depth: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .describe(
                        'How deep into the node tree to traverse; omit for all levels. ' +
                        'Figma sends `children: []` for nodes at the requested depth, whatever they hold.',
                    ),
            },
        },
        figmaTool('ff_get_metadata error', async ({fileKey, nodeId, depth}) => {
            const depthQuery: Record<string, string> = depth === undefined ? {} : {depth: String(depth)};
            const data = nodeId
                ? await figma.get<any>(`/files/${fileKey}/nodes`, {ids: nodeId, ...depthQuery})
                : await figma.get<any>(`/files/${fileKey}`, depthQuery);
            let rootNode: any;

            if (nodeId && data.nodes) {
                const nodeData = data.nodes[nodeId];
                if (!nodeData?.document) throw new FigmaNotFoundError(`Node not found: ${nodeId}`);
                rootNode = nodeData.document;
            } else {
                rootNode = data.document;
            }

            const text = renderTree(rootNode, (tree, frames) => ({
                fileName: data.name || fileKey,
                lastModified: data.lastModified,
                nodeTree: tree,
                topLevelFrames: frames,
                frameCount: frames.length,
            }));

            return {content: [{type: 'text' as const, text}]};
        }),
    );

    // ── ff_get_screenshot ────────────────────────────────────
    server.registerTool(
        'ff_get_screenshot',
        {
            title: 'Get Figma Node Screenshot',
            description:
                'Capture a PNG/JPG/SVG screenshot of a specific Figma node. ' +
                'Returns the image as a base64-encoded image content block or a URL. ' +
                'Target individual top-level frames, not sections or pages.',
            inputSchema: {
                fileKey: z.string().describe('Figma file key'),
                nodeId: z.string().describe('Node ID to screenshot (e.g. "12:3458")'),
                format: z
                    .string()
                    .optional()
                    .describe('Image format: png, jpg, svg, or pdf (default: png)'),
                scale: z
                    .number()
                    .optional()
                    .describe(`Scale factor 0.01-4 (default: ${defaults.screenshotScale}). Higher = more detail.`),
                useAbsoluteBounds: z
                    .boolean()
                    .optional()
                    .describe(
                        'Figma use_absolute_bounds (default: false): use the full dimensions of the node ' +
                        'regardless of whether or not it is cropped or the space around it is empty. ' +
                        'Use this to export text nodes without cropping.',
                    ),
            },
        },
        figmaTool('ff_get_screenshot error', async ({fileKey, nodeId, format = 'png', scale = defaults.screenshotScale, useAbsoluteBounds = false}) => {
            const image = (await figma.getImageBytes(fileKey, [nodeId], {
                format: format as ImageOptions['format'],
                scale: Math.min(Math.max(scale, 0.01), 4),
                // Only when true: the cache entry of a call without it keeps the key it had before the argument existed.
                ...(useAbsoluteBounds ? {useAbsoluteBounds: true} : {}),
            }))[nodeId];
            if (!image) {
                return {content: [{type: 'text' as const, text: `No image returned for node ${nodeId}`}]};
            }
            if (image instanceof ImageDownloadError) {
                if (image.status === undefined) throw image;
                // Fall back to returning the URL
                return {
                    content: [
                        {type: 'text' as const, text: `Screenshot URL (fetch failed): ${image.url}`},
                    ],
                };
            }

            const base64 = image.toString('base64');
            const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'svg' ? 'image/svg+xml' : `image/${format}`;

            return {
                content: [
                    {
                        type: 'image' as const,
                        data: base64,
                        mimeType,
                    },
                ],
            };
        }),
    );

    // ── ff_get_design_context ────────────────────────────────
    server.registerTool(
        'ff_get_design_context',
        {
            _meta: BUDGET_META,
            title: 'Get Figma Design Context',
            description:
                'Extract the design context for a Figma node: layout tree, component structure, ' +
                'styles, text content, and design properties. This is the primary tool for understanding ' +
                'what a screen or component looks like and how it is structured. ' +
                'Prefer this over separate ff_get_screenshot + ff_get_variable_defs calls (1 call vs 2).',
            inputSchema: {
                fileKey: z.string().describe('Figma file key'),
                nodeId: z.string().describe('Node ID to extract (e.g. "12:3458")'),
                depth: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .describe(
                        'How deep into the node tree to traverse; omit for all levels. ' +
                        'Figma sends `children: []` for nodes at the requested depth, whatever they hold.',
                    ),
            },
        },
        figmaTool('ff_get_design_context error', async ({fileKey, nodeId, depth}) => {
            const data = await figma.get<any>(`/files/${fileKey}/nodes`, {
                ids: nodeId,
                ...(depth === undefined ? {} : {depth: String(depth)}),
            });
            const nodeData = data.nodes?.[nodeId];
            if (!nodeData?.document) throw new FigmaNotFoundError(`Node not found: ${nodeId}`);

            const doc = nodeData.document;
            const components = nodeData.components || {};
            const styles = nodeData.styles || {};

            // Build a structured design context
            const text = renderTree(doc, (tree, frames) => ({
                node: {
                    id: doc.id,
                    name: doc.name,
                    type: doc.type,
                    bounds: doc.absoluteBoundingBox,
                    layoutMode: doc.layoutMode,
                    fills: doc.fills,
                    strokes: doc.strokes,
                    effects: doc.effects,
                    padding: {
                        top: doc.paddingTop,
                        right: doc.paddingRight,
                        bottom: doc.paddingBottom,
                        left: doc.paddingLeft,
                    },
                    itemSpacing: doc.itemSpacing,
                    backgroundColor: doc.backgroundColor,
                },
                tree,
                components: Object.keys(components).length > 0 ? components : undefined,
                styles: Object.keys(styles).length > 0 ? styles : undefined,
                frames,
            }));

            return {content: [{type: 'text' as const, text}]};
        }),
    );

    // ── ff_get_variable_defs ─────────────────────────────────
    server.registerTool(
        'ff_get_variable_defs',
        {
            _meta: BUDGET_META,
            title: 'Get Figma Variable Definitions',
            description:
                'Read the variables of a Figma file: colors, spacing, typography, ' +
                'radii, and other values defined in the Variables panel. ' +
                'Maps to the Figma REST API /v1/files/:key/variables/local endpoint.',
            inputSchema: {
                fileKey: z.string().describe('Figma file key'),
            },
        },
        figmaTool('ff_get_variable_defs error', async ({fileKey}) => {
            const data = await figma.get<any>(`/files/${fileKey}/variables/local`).catch((error) => {
                // 403 often means the file doesn't have variables or access is restricted
                if (error instanceof FigmaError && error.statusCode === 403) {
                    throw new FigmaError(
                        'Access denied. This file may not have published variables, ' +
                        'or your access token lacks the required scope. ' +
                        'The Variables REST API requires an Enterprise plan (other plans get 403 "Limited by Figma plan").',
                        'FORBIDDEN',
                        403,
                    );
                }
                throw error;
            });
            const meta = data.meta || {};
            const variables = meta.variables || {};
            const collections = meta.variableCollections || {};

            // Collections are keyed by id (names can repeat); a variable whose collection
            // Figma did not send is still listed, under its collection id.
            const entries = Object.entries(variables) as any[];
            const render = (count: number) => {
                const byId: any = {};
                for (const [collId, coll] of Object.entries(collections) as any[]) {
                    byId[collId] = {
                        name: coll.name,
                        modes: coll.modes?.map((m: any) => ({id: m.modeId, name: m.name})),
                        variables: [] as any[],
                    };
                }
                for (const [varId, v] of entries.slice(0, count)) {
                    const entry: any = {
                        id: varId,
                        name: v.name,
                        resolvedType: v.resolvedType,
                        valuesByMode: v.valuesByMode,
                    };
                    if (v.description) entry.description = v.description;
                    if (v.scopes) entry.scopes = v.scopes;

                    (byId[v.variableCollectionId] ??= {variables: []}).variables.push(entry);
                }
                // variableCount is the variables listed; the file's total is variableCount + omittedVariableIds.length.
                const structured: any = {collectionCount: Object.keys(byId).length, variableCount: count, collections: byId};
                if (count < entries.length) {
                    structured.truncated = true;
                    structured.omittedVariableIds = entries.slice(count).map(([varId]) => varId);
                }
                return JSON.stringify(structured, null, 2);
            };

            return {content: [{type: 'text' as const, text: renderWithinBudget(entries.length, render)}]};
        }),
    );

    // ── ff_whoami ──────────────────────────────────────────────
    server.registerTool(
        'ff_whoami',
        {
            title: 'Figma Who Am I',
            description:
                'Returns the current authenticated user. Use this to verify the Figma MCP is working. ' +
                'This tool is exempt from rate limits — always safe to call.',
            inputSchema: {},
        },
        figmaTool('ff_whoami error', async () => {
            const data = await figma.get<any>('/me');
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {id: data.id, handle: data.handle, email: data.email, img_url: data.img_url},
                            null,
                            2,
                        ),
                    },
                ],
            };
        }),
    );

    Logger.diag('📋 Registered core Figma tools: ff_get_metadata, ff_get_screenshot, ff_get_design_context, ff_get_variable_defs, ff_whoami');
}
