// src/tools/figma-core/core-tools.ts
// Drop-in replacements for the official Figma MCP tools (get_metadata, get_screenshot,
// get_design_context, get_variable_defs) that call the REST API directly via personal
// access token — bypassing the official MCP server's 200/day rate limit.

import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {FigmaService, figmaApiBaseUrl} from '../../services/figma.js';
import {Logger} from '../../utils/logger.js';
import defaults from '../../defaults.json' with { type: 'json' };
import fetch from 'node-fetch';

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

const countNodes = (node: any): number => 1 + (node.children ?? []).reduce((n: number, c: any) => n + countNodes(c), 0);

/**
 * `render(n)` serialises the first n of `total` items in document order. Returns the
 * text for all of them when it fits the budget, else for the most that fit (at least one).
 */
function renderWithinBudget(total: number, render: (n: number) => string): string {
    const whole = render(total);
    if (whole.length <= defaults.maxResultSizeChars) return whole;
    let [fits, over] = [1, total];
    while (over - fits > 1) {
        const mid = Math.floor((fits + over) / 2);
        if (render(mid).length <= defaults.maxResultSizeChars) fits = mid;
        else over = mid;
    }
    return render(fits);
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
    return renderWithinBudget(countNodes(root), render);
}

// ────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────

export function registerCoreTools(server: McpServer, figmaApiKey: string) {
    const figma = new FigmaService(figmaApiKey);
    const baseUrl = figmaApiBaseUrl();
    const headers = {
        'X-Figma-Token': figmaApiKey,
        'Content-Type': 'application/json',
    };

    // ── ff_get_metadata ──────────────────────────────────────
    server.registerTool(
        'ff_get_metadata',
        {
            _meta: {'anthropic/maxResultSizeChars': defaults.maxResultSizeChars},
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
        async ({fileKey, nodeId, depth}) => {
            try {
                const depthParam = depth === undefined ? '' : `depth=${depth}`;
                let url: string;
                if (nodeId) {
                    url = `${baseUrl}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}${depthParam && `&${depthParam}`}`;
                } else {
                    url = `${baseUrl}/files/${fileKey}${depthParam && `?${depthParam}`}`;
                }

                const resp = await fetch(url, {headers});
                if (!resp.ok) {
                    const body = await resp.text();
                    return {content: [{type: 'text' as const, text: `Error ${resp.status}: ${body}`}]};
                }

                const data = (await resp.json()) as any;
                let rootNode: any;

                if (nodeId && data.nodes) {
                    const nodeData = data.nodes[nodeId];
                    if (!nodeData?.document) {
                        return {content: [{type: 'text' as const, text: `Node ${nodeId} not found in file ${fileKey}`}]};
                    }
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
            } catch (err: any) {
                return {content: [{type: 'text' as const, text: `ff_get_metadata error: ${err.message}`}]};
            }
        },
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
            },
        },
        async ({fileKey, nodeId, format = 'png', scale = defaults.screenshotScale}) => {
            try {
                const params = new URLSearchParams({
                    ids: nodeId,
                    format,
                    scale: String(Math.min(Math.max(scale, 0.01), 4)),
                });
                const resp = await fetch(`${baseUrl}/images/${fileKey}?${params}`, {headers});
                if (!resp.ok) {
                    const body = await resp.text();
                    return {content: [{type: 'text' as const, text: `Error ${resp.status}: ${body}`}]};
                }

                const data = (await resp.json()) as any;
                if (data.err) {
                    return {content: [{type: 'text' as const, text: `Figma image error: ${data.err}`}]};
                }

                const imageUrl = data.images?.[nodeId];
                if (!imageUrl) {
                    return {content: [{type: 'text' as const, text: `No image returned for node ${nodeId}`}]};
                }

                // Fetch the actual image and return as base64
                const imgResp = await fetch(imageUrl);
                if (!imgResp.ok) {
                    // Fall back to returning the URL
                    return {
                        content: [
                            {type: 'text' as const, text: `Screenshot URL (fetch failed): ${imageUrl}`},
                        ],
                    };
                }

                const imgBuffer = await imgResp.buffer();
                const base64 = imgBuffer.toString('base64');
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
            } catch (err: any) {
                return {content: [{type: 'text' as const, text: `ff_get_screenshot error: ${err.message}`}]};
            }
        },
    );

    // ── ff_get_design_context ────────────────────────────────
    server.registerTool(
        'ff_get_design_context',
        {
            _meta: {'anthropic/maxResultSizeChars': defaults.maxResultSizeChars},
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
        async ({fileKey, nodeId, depth}) => {
            try {
                const url = `${baseUrl}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths&plugin_data=shared` +
                    (depth === undefined ? '' : `&depth=${depth}`);
                const resp = await fetch(url, {headers});
                if (!resp.ok) {
                    const body = await resp.text();
                    return {content: [{type: 'text' as const, text: `Error ${resp.status}: ${body}`}]};
                }

                const data = (await resp.json()) as any;
                const nodeData = data.nodes?.[nodeId];
                if (!nodeData?.document) {
                    return {content: [{type: 'text' as const, text: `Node ${nodeId} not found`}]};
                }

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
            } catch (err: any) {
                return {content: [{type: 'text' as const, text: `ff_get_design_context error: ${err.message}`}]};
            }
        },
    );

    // ── ff_get_variable_defs ─────────────────────────────────
    server.registerTool(
        'ff_get_variable_defs',
        {
            _meta: {'anthropic/maxResultSizeChars': defaults.maxResultSizeChars},
            title: 'Get Figma Variable Definitions',
            description:
                'Read the variables of a Figma file: colors, spacing, typography, ' +
                'radii, and other values defined in the Variables panel. ' +
                'Maps to the Figma REST API /v1/files/:key/variables/local endpoint.',
            inputSchema: {
                fileKey: z.string().describe('Figma file key'),
            },
        },
        async ({fileKey}) => {
            try {
                const resp = await fetch(`${baseUrl}/files/${fileKey}/variables/local`, {headers});
                if (!resp.ok) {
                    const body = await resp.text();
                    // 403 often means the file doesn't have variables or access is restricted
                    if (resp.status === 403) {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text:
                                        'Access denied (403). This file may not have published variables, ' +
                                        'or your access token lacks the required scope. ' +
                                        'The Variables REST API requires an Enterprise plan (other plans get 403 "Limited by Figma plan").',
                                },
                            ],
                            isError: true,
                        };
                    }
                    // A 429 is only actionable with its wait; name the headers Figma sent.
                    const retryAfter = resp.headers.get('retry-after');
                    const rateLimit = resp.status === 429 ? [
                        retryAfter && `Retry after ${retryAfter} seconds`,
                        ...['x-figma-plan-tier', 'x-figma-rate-limit-type'].map(name => resp.headers.get(name) && `${name}: ${resp.headers.get(name)}`),
                    ].filter(Boolean) : [];
                    const details = rateLimit.length > 0 ? ` (${rateLimit.join(', ')})` : '';
                    return {content: [{type: 'text' as const, text: `Error ${resp.status}: ${body}${details}`}], isError: true};
                }

                const data = (await resp.json()) as any;
                const meta = data.meta || {};
                const variables = meta.variables || {};
                const collections = meta.variableCollections || {};

                // Collections are keyed by id (names can repeat); a variable whose collection
                // Figma did not send is still listed, under its collection id.
                const entries = Object.entries(variables) as any[];
                const render = (count: number) => {
                    const structured: any = {collectionCount: 0, variableCount: count, collections: {} as any};
                    for (const [collId, coll] of Object.entries(collections) as any[]) {
                        structured.collections[collId] = {
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

                        (structured.collections[v.variableCollectionId] ??= {variables: []}).variables.push(entry);
                    }
                    structured.collectionCount = Object.keys(structured.collections).length;
                    if (count < entries.length) {
                        structured.truncated = true;
                        structured.omittedVariableIds = entries.slice(count).map(([varId]) => varId);
                    }
                    return JSON.stringify(structured, null, 2);
                };

                return {content: [{type: 'text' as const, text: renderWithinBudget(entries.length, render)}]};
            } catch (err: any) {
                return {content: [{type: 'text' as const, text: `ff_get_variable_defs error: ${err.message}`}], isError: true};
            }
        },
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
        async () => {
            try {
                const resp = await fetch(`${baseUrl}/me`, {headers});
                if (!resp.ok) {
                    const body = await resp.text();
                    return {content: [{type: 'text' as const, text: `Error ${resp.status}: ${body}`}]};
                }
                const data = (await resp.json()) as any;
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
            } catch (err: any) {
                return {content: [{type: 'text' as const, text: `ff_whoami error: ${err.message}`}]};
            }
        },
    );

    Logger.diag('📋 Registered core Figma tools: ff_get_metadata, ff_get_screenshot, ff_get_design_context, ff_get_variable_defs, ff_whoami');
}
