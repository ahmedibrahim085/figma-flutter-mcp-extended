// services/figma-snapshot.ts
import type {FileCache} from './figma-cache.js';

/**
 * A whole file (the reply of `GET /files/:key`) stored so that one node can be cut out without parsing the rest:
 * the top-level frames end to end in one entry, and an index entry that holds the file-wide maps, the page shells,
 * each frame's byte range and the frame that holds each node id. Measured at 100 MB and 130,000 nodes: a node read
 * takes 0.07 ms and the process holds 82 MB, where parsing the whole file per read takes about 0.5 s.
 */
const FRAMES = 'snapshot-frames';
const INDEX = 'snapshot-index';

/** The reply fields `/nodes` carries besides `nodes`, in the order Figma sends them. */
const TOP_FIELDS = ['name', 'lastModified', 'thumbnailUrl', 'version', 'role', 'editorType', 'linkAccess'];

interface Index {
    top: Record<string, unknown>;
    schemaVersion: unknown;
    components: Record<string, any>;
    componentSets: Record<string, any>;
    styles: Record<string, any>;
    /** The document and each page with `children: []`, which keeps the position of the `children` key. */
    shells: Record<string, any>;
    documentId: string;
    /** Per page id, the numbers of its frames in document order. */
    pages: Record<string, number[]>;
    /** Per frame number, its byte offset and length in the frames entry. */
    ranges: Array<[number, number]>;
    /** Node id to the number of the frame that holds it. */
    owner: Record<string, number>;
}

/** Stores the reply of `GET /files/:key`. Returns false when it could not be written. */
export async function storeSnapshot(cache: FileCache, file: any): Promise<boolean> {
    const document = file?.document;
    if (!document || !Array.isArray(document.children)) return false;
    const chunks: Buffer[] = [];
    const ranges: Array<[number, number]> = [];
    const owner: Record<string, number> = {};
    const pages: Record<string, number[]> = {};
    const shells: Record<string, any> = {[document.id]: {...document, children: []}};
    let offset = 0;
    const own = (node: any, frame: number) => {
        owner[node.id] = frame;
        for (const child of node.children ?? []) own(child, frame);
    };
    for (const page of document.children) {
        shells[page.id] = {...page, children: []};
        pages[page.id] = [];
        for (const frame of page.children ?? []) {
            const chunk = Buffer.from(JSON.stringify(frame));
            own(frame, ranges.length);
            pages[page.id].push(ranges.length);
            ranges.push([offset, chunk.length]);
            chunks.push(chunk);
            offset += chunk.length;
        }
    }
    const index: Index = {
        top: Object.fromEntries(TOP_FIELDS.filter((field) => field in file).map((field) => [field, file[field]])),
        schemaVersion: file.schemaVersion, components: file.components ?? {}, componentSets: file.componentSets ?? {}, styles: file.styles ?? {},
        shells, documentId: document.id, pages, ranges, owner,
    };
    // The index is written last: an index entry means the frames entry is complete.
    return (await cache.write(FRAMES, Buffer.concat(chunks))) && (await cache.write(INDEX, JSON.stringify(index)));
}

/** True when a snapshot of this file version is stored. */
export async function hasSnapshot(cache: FileCache): Promise<boolean> {
    return (await cache.read(INDEX)) !== undefined;
}

/** Every node of the subtree of `node`, itself included, children before their parent. */
function postOrder(node: any, out: any[] = []): any[] {
    for (const child of node.children ?? []) postOrder(child, out);
    out.push(node);
    return out;
}

/** The node with `id` inside `root`. */
function find(root: any, id: string): any {
    if (root.id === id) return root;
    for (const child of root.children ?? []) {
        const found = find(child, id);
        if (found) return found;
    }
    return undefined;
}

/** The node `id` as the file holds it: inside a frame, a page or the document (the last two put together from their frames). Undefined for an id the file lacks. */
async function nodeOf(index: Index, id: string, frame: (number: number) => Promise<any>): Promise<any> {
    if (!index.shells[id]) return index.owner[id] === undefined ? undefined : find(await frame(index.owner[id]), id);
    const page = async (pageId: string) => ({...index.shells[pageId], children: await Promise.all(index.pages[pageId].map(frame))});
    if (id !== index.documentId) return page(id);
    return {...index.shells[id], children: await Promise.all(Object.keys(index.pages).map(page))};
}

/**
 * The maps of one `/nodes` entry: the part of the file-wide maps that the subtree uses. Figma lists them in the order the
 * subtree first refers to each item, children before their parent (checked on 7 real entries of two files). Its componentSets
 * entries carry other metadata fields than the file-wide map in some files (`remote` for `documentationLinks`); the tools
 * read only their `name`.
 */
function entryMaps(index: Index, document: any) {
    const members = postOrder(document);
    const componentKeys = new Set<string>();
    const styleKeys = new Set<string>();
    for (const node of members) {
        if (node.id in index.components) componentKeys.add(node.id);
        if (typeof node.componentId === 'string' && node.componentId in index.components) componentKeys.add(node.componentId);
        for (const [key, value] of Object.entries(node)) {
            if (key.endsWith('StyleId') && typeof value === 'string') styleKeys.add(value);
            else if (key === 'styles' && value && typeof value === 'object') Object.values(value).forEach((style) => typeof style === 'string' && styleKeys.add(style));
        }
    }
    const pick = (map: Record<string, any>, keys: Iterable<string>) => Object.fromEntries([...keys].filter((key) => key in map).map((key) => [key, map[key]]));
    const components = pick(index.components, componentKeys);
    const setKeys = new Set<string>(Object.values(components).flatMap((component: any) => (component.componentSetId ? [component.componentSetId] : [])));
    for (const node of members) if (node.id in index.componentSets) setKeys.add(node.id);
    return {components, componentSets: pick(index.componentSets, setKeys), styles: pick(index.styles, styleKeys)};
}

/**
 * The reply of `GET /files/:key/nodes?ids=` for `ids`, cut from the stored snapshot: each entry holds the node and the
 * part of the file-wide maps that its subtree uses, which is what Figma sends. An id the file does not hold is `null`,
 * as in Figma's reply. Undefined when there is no snapshot; throws when the frames entry is gone, and the caller then
 * reads the node from Figma.
 */
export async function readSnapshotNodes(cache: FileCache, ids: string[]): Promise<any | undefined> {
    const stored = await cache.read(INDEX);
    if (!stored) return undefined;
    const index: Index = JSON.parse(stored.toString());
    const frame = async (number: number) => {
        const [offset, length] = index.ranges[number];
        const bytes = await cache.readRange(FRAMES, offset, length);
        if (!bytes) throw new Error('snapshot frames are missing');
        return JSON.parse(bytes.toString());
    };
    const nodes: Record<string, any> = {};
    for (const id of ids) {
        const document = await nodeOf(index, id, frame);
        if (!document) {
            nodes[id] = null;
            continue;
        }
        const {components, componentSets, styles} = entryMaps(index, document);
        nodes[id] = {document, components, componentSets, schemaVersion: index.schemaVersion, styles};
    }
    return {...index.top, nodes};
}
