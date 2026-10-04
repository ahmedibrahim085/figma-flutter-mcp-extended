// services/figma.mts
import fetch from 'node-fetch';
import type {FigmaNode, NodeResponse} from '../types/figma.js';
import {
    FigmaError,
    FigmaAuthError,
    FigmaNotFoundError,
    FigmaNetworkError,
    FigmaParseError,
    createFigmaError
} from '../types/errors.js';
import {withRetry} from '../utils/retry.js';
import defaults from '../defaults.json' with { type: 'json' };
import {Logger} from '../utils/logger.js';
import {FileCache, entryName, figmaCacheDir, figmaSnapshotEnabled, isCacheableFileKey} from './figma-cache.js';
import {hasSnapshot, readSnapshotNodes, storeSnapshot} from './figma-snapshot.js';

/**
 * Figma REST base URL. `FIGMA_API_BASE_URL` overrides it (the test suite points
 * it at a local fake Figma server); unset means the real API.
 */
export function figmaApiBaseUrl(): string {
    return process.env.FIGMA_API_BASE_URL || 'https://api.figma.com/v1';
}

/** A render that could not be downloaded: `status` is the HTTP status of a refusal, and absent when the request itself failed (see `cause`). */
export class ImageDownloadError extends Error {
    constructor(readonly url: string, readonly status?: number, cause?: unknown) {
        super(status === undefined ? `Failed to download image: ${cause}` : `Failed to download image: HTTP ${status}`, {cause});
    }
}

export type ImageOptions = {
    format?: 'png' | 'jpg' | 'svg' | 'pdf';
    scale?: number;
    svgIncludeId?: boolean;
    svgSimplifyStroke?: boolean;
    svgOutlineText?: boolean;
    /** Figma use_absolute_bounds: the node's full box, not its render bounds (a cropped text node). */
    useAbsoluteBounds?: boolean;
};

export class FigmaService {
    private accessToken: string;
    private baseUrl = figmaApiBaseUrl();

    constructor(accessToken: string) {
        if (!accessToken || accessToken.trim().length === 0) {
            throw new FigmaAuthError('Figma access token is required');
        }
        this.accessToken = accessToken;
    }

    /**
     * Core API request method with retry logic
     */
    private async makeRequest<T>(endpoint: string): Promise<T> {
        return withRetry(async () => {
            const url = `${this.baseUrl}${endpoint}`;

            try {
                Logger.diag(`🔄 Making Figma API request: ${endpoint}`);

                const response = await fetch(url, {
                    headers: {
                        'X-Figma-Token': this.accessToken,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    let errorDetails = '';
                    try {
                        const errorBody = await response.text();
                        if (errorBody) {
                            const parsedError = JSON.parse(errorBody);
                            errorDetails = parsedError.err || parsedError.message || parsedError.error || errorBody;
                        }
                    } catch {
                        // Ignore parse errors for error body
                    }

                    throw createFigmaError(response, errorDetails);
                }

                const data = await response.json() as T;
                Logger.diag(`✅ Successfully fetched: ${endpoint}`);
                return data;

            } catch (error) {
                if (error instanceof FigmaError) {
                    throw error;
                }

                if (error instanceof Error) {
                    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
                        throw new FigmaNetworkError('Unable to connect to Figma API', error);
                    }

                    if (error.name === 'SyntaxError') {
                        throw new FigmaParseError('Invalid JSON response from Figma API', error);
                    }
                }

                throw new FigmaNetworkError(`Unexpected error: ${error}`, error as Error);
            }
        }, defaults.retry);
    }

    /**
     * The cache of one file at its current marker, or undefined when the cache is off. Asks `/meta` with the
     * caller's own key on every call, so a key that cannot open the file fails here as it does without the cache,
     * and a file that changed is never answered from an older copy. `version` alone is not enough: it is the id of
     * the latest checkpoint and stays the same across edits, while `last_touched_at` moves with each one.
     */
    private async fileCache(fileId: string): Promise<FileCache | undefined> {
        const dir = figmaCacheDir();
        if (!dir || !isCacheableFileKey(fileId)) return undefined;
        const {file} = await this.makeRequest<{file?: {version?: string; last_touched_at?: string}}>(`/files/${fileId}/meta`);
        if (!file?.version || !file.last_touched_at) return undefined;
        return new FileCache(dir, fileId, [file.version, file.last_touched_at]);
    }

    /** The node ids of a `/nodes` query that a snapshot answers: `ids` alone. A depth (or anything else) is read from Figma, whose cut at the boundary is not known offline. */
    private snapshotIds(query: string | undefined): string[] | undefined {
        const params = new URLSearchParams(query);
        const ids = params.get('ids');
        return figmaSnapshotEnabled() && ids && [...params.keys()].every((key) => key === 'ids') ? ids.split(',') : undefined;
    }

    /** Folders whose whole-file download failed in this process; they are read node by node from then on. */
    private failedSnapshots = new Set<string>();
    private downloads = new Map<string, Promise<boolean>>();

    /** True when a snapshot of this file version is stored, downloading it once (shared by concurrent reads) if it is not. */
    private ensureSnapshot(fileId: string, cache: FileCache): Promise<boolean> {
        if (this.failedSnapshots.has(cache.folder)) return Promise.resolve(false);
        let download = this.downloads.get(cache.folder);
        if (!download) {
            download = (async () => {
                try {
                    if (await hasSnapshot(cache)) return true;
                    if (await storeSnapshot(cache, await this.makeRequest<any>(`/files/${fileId}`))) return true;
                } catch {
                    // Figma refused or timed out (a file too large for one read): fall through to the node read.
                }
                this.failedSnapshots.add(cache.folder);
                return false;
            })().finally(() => this.downloads.delete(cache.folder));
            this.downloads.set(cache.folder, download);
        }
        return download;
    }

    /** `makeRequest` for the file and node reads, served from the cache while the file is unchanged. */
    private async cachedRequest<T>(endpoint: string): Promise<T> {
        const [, fileId, nodes, query] = endpoint.match(/^\/files\/([^/?]+)(\/nodes)?(?:\?(.*))?$/) ?? [];
        const cache = fileId ? await this.fileCache(fileId) : undefined;
        if (!cache) return this.makeRequest<T>(endpoint);
        const ids = nodes ? this.snapshotIds(query) : undefined;
        if (ids && (await this.ensureSnapshot(fileId, cache))) {
            const cut = await readSnapshotNodes(cache, ids).catch(() => undefined);
            if (cut) return cut as T;
        }
        const name = entryName(nodes ? 'nodes' : 'file', new URLSearchParams(query));
        const stored = await cache.read(name);
        if (stored) return JSON.parse(stored.toString()) as T;
        const data = await this.makeRequest<T>(endpoint);
        await cache.write(name, JSON.stringify(data));
        return data;
    }

    /**
     * One Figma REST GET with the shared retry policy; returns Figma's JSON as sent.
     * The tools that render Figma's response themselves use this; the typed methods below reshape it.
     */
    async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
        const params = new URLSearchParams(query).toString();
        return this.cachedRequest<T>(params ? `${path}?${params}` : path);
    }

    /**
     * Get specific nodes by IDs
     */
    async getNodes(fileId: string, nodeIds: string[]): Promise<Record<string, FigmaNode>> {
        if (!nodeIds || nodeIds.length === 0) {
            throw new FigmaError('At least one node ID is required', 'INVALID_INPUT');
        }

        try {
            const data = await this.cachedRequest<any>(`/files/${fileId}/nodes?ids=${nodeIds.join(',')}`);

            const nodes: Record<string, FigmaNode> = {};
            Object.entries(data.nodes || {}).forEach(([nodeId, nodeData]: [string, any]) => {
                if (nodeData?.document) {
                    nodes[nodeId] = nodeData.document;
                }
            });

            return nodes;
        } catch (error) {
            if (error instanceof FigmaError) {
                throw error;
            }
            throw new FigmaError(`Failed to fetch nodes: ${error}`, 'FETCH_ERROR');
        }
    }

    /**
     * Get a single node by ID
     */
    async getNode(fileId: string, nodeId: string): Promise<FigmaNode> {
        return (await this.getNodeWithStyles(fileId, nodeId)).document;
    }

    /**
     * Get a single node by ID with the response's style map: style id to `{name, styleType}`.
     */
    async getNodeWithStyles(fileId: string, nodeId: string): Promise<{document: FigmaNode; styles: Record<string, {name: string; styleType: string}>; componentSetName?: string}> {
        if (!nodeId || nodeId.trim().length === 0) {
            throw new FigmaError('Node ID is required', 'INVALID_INPUT');
        }

        try {
            const data = await this.cachedRequest<NodeResponse>(`/files/${fileId}/nodes?ids=${nodeId}`);

            if (!data.nodes || !data.nodes[nodeId]) {
                throw new FigmaNotFoundError(`Node not found: ${nodeId}`);
            }

            const nodeData = data.nodes[nodeId];
            if (!nodeData.document) {
                throw new FigmaParseError('Invalid node structure received from Figma API', nodeData);
            }

            const componentSetId = nodeData.components?.[nodeId]?.componentSetId;
            return {document: nodeData.document, styles: nodeData.styles ?? {}, componentSetName: componentSetId ? nodeData.componentSets?.[componentSetId]?.name : undefined};
        } catch (error) {
            if (error instanceof FigmaError) {
                throw error;
            }
            throw new FigmaError(`Failed to fetch node ${nodeId}: ${error}`, 'FETCH_ERROR');
        }
    }

    /**
     * Names of the file's local variables by id (Figma REST GET /v1/files/:key/variables/local).
     * Throws when Figma refuses, e.g. 403 outside an Enterprise plan.
     */
    async getLocalVariableNames(fileId: string): Promise<Record<string, string>> {
        const data = await this.makeRequest<{meta?: {variables?: Record<string, {name: string}>}}>(`/files/${fileId}/variables/local`);
        return Object.fromEntries(Object.entries(data.meta?.variables ?? {}).map(([id, variable]) => [id, variable.name]));
    }

    /**
     * Get image export URLs
     */
    async getImageExportUrls(
        fileId: string,
        nodeIds: string[],
        options: ImageOptions = {}
    ): Promise<Record<string, string>> {
        if (!nodeIds || nodeIds.length === 0) {
            return {};
        }

        const params = new URLSearchParams({
            ids: nodeIds.join(','),
            format: options.format || 'png'
        });

        if (options.scale && ['png', 'jpg'].includes(options.format || 'png')) {
            params.append('scale', options.scale.toString());
        }

        if (options.useAbsoluteBounds) {
            params.append('use_absolute_bounds', 'true');
        }

        if (options.format === 'svg') {
            if (options.svgIncludeId !== undefined) {
                params.append('svg_include_id', options.svgIncludeId.toString());
            }
            if (options.svgSimplifyStroke !== undefined) {
                params.append('svg_simplify_stroke', options.svgSimplifyStroke.toString());
            }
            if (options.svgOutlineText !== undefined) {
                params.append('svg_outline_text', options.svgOutlineText.toString());
            }
        }

        try {
            const response = await this.makeRequest<any>(`/images/${fileId}?${params}`);

            if (response.err) {
                throw new FigmaError(`Image export failed: ${response.err}`, 'EXPORT_ERROR');
            }

            // Filter out null values
            const validImages: Record<string, string> = {};
            Object.entries(response.images || {}).forEach(([nodeId, url]) => {
                if (url && typeof url === 'string') {
                    validImages[nodeId] = url;
                }
            });

            return validImages;
        } catch (error) {
            if (error instanceof FigmaError) {
                throw error;
            }
            throw new FigmaError(`Failed to export images: ${error}`, 'EXPORT_ERROR');
        }
    }

    /**
     * The rendered bytes of each node, keyed by node id. A render Figma returned no URL for is absent; one whose
     * download failed is an ImageDownloadError. Bytes are cached, not the render URLs, which expire after 30 days:
     * a file left alone keeps its marker, so a cached URL would outlive its image. Only successful downloads are stored.
     */
    async getImageBytes(fileId: string, nodeIds: string[], options: ImageOptions = {}): Promise<Record<string, Buffer | ImageDownloadError>> {
        if (!nodeIds || nodeIds.length === 0) return {};
        const cache = await this.fileCache(fileId);
        const entry = (nodeId: string) => entryName('image', {id: nodeId, ...Object.fromEntries(Object.entries(options).map(([key, value]) => [key, String(value)]))});
        const images: Record<string, Buffer | ImageDownloadError> = {};
        const missing: string[] = [];
        for (const nodeId of nodeIds) {
            const stored = await cache?.read(entry(nodeId));
            if (stored) images[nodeId] = stored;
            else missing.push(nodeId);
        }
        if (missing.length === 0) return images;
        const urls = await this.getImageExportUrls(fileId, missing, options);
        for (const nodeId of missing) {
            const url = urls[nodeId];
            if (!url) continue;
            // The render URL is not a Figma REST call (it carries its own token), so it is a plain fetch.
            // The runtime's own fetch, not node-fetch: its errors carry `cause.code`, which asset notes report.
            try {
                const response = await globalThis.fetch(url);
                if (!response.ok) {
                    images[nodeId] = new ImageDownloadError(url, response.status);
                    continue;
                }
                images[nodeId] = Buffer.from(await response.arrayBuffer());
                await cache?.write(entry(nodeId), images[nodeId]);
            } catch (error) {
                images[nodeId] = new ImageDownloadError(url, undefined, error);
            }
        }
        return images;
    }

    /**
     * Get image fills used in the file
     */
    async getImageFillUrls(fileId: string): Promise<Record<string, string>> {
        try {
            const response = await this.makeRequest<any>(`/files/${fileId}/images`);
            return response.meta?.images || {};
        } catch (error) {
            if (error instanceof FigmaError) {
                throw error;
            }
            throw new FigmaError(`Failed to fetch image fills: ${error}`, 'FETCH_ERROR');
        }
    }
}