// tools/flutter/asset-manager.mts
import {existsSync} from 'fs';
import {writeFile, mkdir, readFile} from 'fs/promises';
import {join, dirname} from 'path';
import {z} from 'zod';
import {ImageDownloadError, type FigmaService} from '../../../services/figma.js';
import {isEffectivelyVisible} from '../../../utils/visibility.js';
import {detectConstantsDir} from '../../../utils/project-conventions.js';
import {isDartIdentifier, lowerCamelCase} from '../../../utils/dart-names.js';
import defaults from '../../../defaults.json' with { type: 'json' };

export interface AssetInfo {
    nodeId: string;
    nodeName: string;
    filename: string;
    path: string;
    size: string;
}

export async function createAssetsDirectory(projectPath: string): Promise<string> {
    const assetsDir = join(projectPath, defaults.output.imagesDir);
    await mkdir(assetsDir, {recursive: true});
    return assetsDir;
}

export async function createSvgAssetsDirectory(projectPath: string): Promise<string> {
    const assetsDir = join(projectPath, defaults.output.svgsDir);
    await mkdir(assetsDir, {recursive: true});
    return assetsDir;
}

/**
 * Filename relative to the images folder. Scales above 1 go into Flutter's
 * resolution-aware `N.0x/` sub-folders: Flutter treats the main asset as 1.0x
 * and ignores flat `name@2x.png` files (docs.flutter.dev, "Resolution-aware
 * image assets"). A 2x render saved as the main asset displays at double size.
 */
export function generateAssetFilename(nodeName: string, format: string, scale: number): string {
    // Clean the node name for filename
    const cleanName = nodeName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

    if (scale > 1) {
        const variantFolder = Number.isInteger(scale) ? `${scale}.0x` : `${scale}x`;
        return `${variantFolder}/${cleanName}.${format}`;
    }

    return `${cleanName}.${format}`;
}

/** Strip a resolution-variant folder (`2.0x/`, `1.5x/`) so only the main asset path remains. */
export function toMainAssetPath(path: string): string {
    return path.replace(/(^|\/)\d+(?:\.\d+)?x\//, '$1');
}

export function generateSvgFilename(nodeName: string): string {
    // Clean the node name for SVG filename
    const cleanName = nodeName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

    return `${cleanName}.svg`;
}

export async function saveImage(bytes: Buffer, filepath: string): Promise<void> {
    await mkdir(dirname(filepath), {recursive: true});
    await writeFile(filepath, bytes);
}

export async function getFileStats(filepath: string): Promise<{size: string}> {
    try {
        const {size} = await import('fs').then(fs => fs.promises.stat(filepath));
        return {
            size: size > 1024 * 1024
                ? `${(size / 1024 / 1024).toFixed(1)}MB`
                : `${Math.round(size / 1024)}KB`
        };
    } catch {
        return {size: 'Unknown'};
    }
}

export async function updatePubspecAssets(pubspecPath: string, assets: Array<{path: string}>): Promise<void> {
    const pubspecContent = await readFile(pubspecPath, 'utf-8');

    // Only the top-level `flutter:` key owns the asset list. Matching the first
    // `flutter:` / `assets:` text instead hit `dependencies: flutter:` and
    // `flutter_gen: assets:` and wrote invalid YAML into the consumer's pubspec.
    // Shapes this line editor cannot rewrite safely are refused, never guessed:
    // the error names the lines to add by hand.
    const mainPaths = [...new Set(assets.map(asset => toMainAssetPath(asset.path)))];
    const refuse = (reason: string) => new Error(
        `pubspec.yaml left unchanged (${reason}). Add these under flutter: assets: ${mainPaths.join(', ')}`);

    const eol = pubspecContent.includes('\r\n') ? '\r\n' : '\n';
    const lines = pubspecContent.split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const isBlockLine = (line: string) => line.trim() === '' || /^\s/.test(line) || line.startsWith('#');
    const isBlankOrComment = (line: string) => line.trim() === '' || line.trim().startsWith('#');

    if (lines.some(line => /^flutter:/.test(line) && !/^flutter:\s*(#.*)?$/.test(line))) {
        throw refuse('top-level flutter: is not a block mapping');
    }
    let flutterIdx = lines.findIndex(line => /^flutter:\s*(#.*)?$/.test(line));
    if (flutterIdx === -1) {
        lines.push('', 'flutter:');
        flutterIdx = lines.length - 1;
    }
    let blockEnd = flutterIdx + 1;
    while (blockEnd < lines.length && isBlockLine(lines[blockEnd])) blockEnd++;

    const firstChild = lines.slice(flutterIdx + 1, blockEnd).find(line => line.trim() !== '' && !line.trim().startsWith('#'));
    const childIndent = firstChild ? firstChild.match(/^\s*/)![0] : '  ';
    const assetsKey = new RegExp(`^${childIndent}assets:\\s*(.*)$`);

    let assetsIdx = -1;
    for (let i = flutterIdx + 1; i < blockEnd; i++) {
        if (assetsKey.test(lines[i])) {
            assetsIdx = i;
            break;
        }
    }

    const existing: string[] = [];
    let itemIndent = `${childIndent}  `;
    let insertAt: number;
    if (assetsIdx === -1) {
        lines.splice(flutterIdx + 1, 0, `${childIndent}assets:`);
        assetsIdx = flutterIdx + 1;
        insertAt = assetsIdx + 1;
    } else {
        // Flow form (`assets: [a, b]`) on one line is rewritten as a block list.
        const inline = lines[assetsIdx].match(assetsKey)![1].replace(/#.*$/, '').trim();
        if (inline !== '' && !(inline.startsWith('[') && inline.endsWith(']'))) {
            throw refuse('assets: is not a block list or a one-line flow list');
        }
        if (inline !== '') {
            const flowEntries = inline.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
            lines[assetsIdx] = `${childIndent}assets:`;
            lines.splice(assetsIdx + 1, 0, ...flowEntries.map(entry => `${itemIndent}- ${entry}`));
        }
        insertAt = assetsIdx + 1;
        for (let i = assetsIdx + 1; i < lines.length; i++) {
            if (isBlankOrComment(lines[i])) continue;
            if (!/^\s*-\s/.test(lines[i])) {
                // Anything indented deeper than the items belongs to a map-form entry
                // (`- path: …` + `flavors:`), which this editor does not rewrite.
                if (existing.length > 0 && lines[i].match(/^\s*/)![0].length > itemIndent.length) {
                    throw refuse('asset entries use the map form');
                }
                break;
            }
            const entry = lines[i].replace(/^\s*-\s*/, '').replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
            if (/^[\w-]+:(\s|$)/.test(entry)) throw refuse('asset entries use the map form');
            itemIndent = lines[i].match(/^\s*/)![0];
            existing.push(entry);
            insertAt = i + 1;
        }
    }

    // A directory entry bundles only files directly inside it, and only when the
    // main file exists: a directory with just `2.0x/x.png` bundles nothing
    // (flutter build bundle, Flutter 3.47.5). An explicit main entry works
    // without the main file (the variant is used). Variants need no entry.
    const projectDir = dirname(pubspecPath);
    const isCovered = (path: string) => existing.some(entry =>
        entry === path || (entry.endsWith('/') && path.startsWith(entry) &&
            !path.slice(entry.length).includes('/') && existsSync(join(projectDir, path))));
    const toAdd = mainPaths.filter(path => !isCovered(path));
    lines.splice(insertAt, 0, ...toAdd.map(path => `${itemIndent}- ${path}`));

    await writeFile(pubspecPath, `${lines.join(eol)}${eol}`);
}

/** True when the project generates its own `Assets` class with flutter_gen. */
async function usesFlutterGen(projectPath: string): Promise<boolean> {
    try {
        const pubspec = await readFile(join(projectPath, 'pubspec.yaml'), 'utf-8');
        return /^\s*flutter_gen(_runner)?\s*:/m.test(pubspec);
    } catch {
        return false;
    }
}

/** What a constants writer put in its file: the report reads this, never re-derives it. */
export interface WrittenConstants {
    path: string;
    className: string;
    /** Asset path to the constant that holds it in `path`. */
    names: Map<string, string>;
    /** Assets that got no constant, with the reason. */
    skipped: Array<{assetPath: string; nodeName: string; reason: string}>;
}

/**
 * Merge constants for `entries` into the class in `file`. A constant is the layer name in lowerCamelCase; a name
 * that is not a valid Dart identifier, or that another asset already took, gets none. Nothing is invented.
 */
async function writeConstants(entries: Array<{assetPath: string; nodeName: string}>, projectPath: string, file: string, className: string, title: string): Promise<WrittenConstants> {
    const constantsDir = await detectConstantsDir(projectPath);
    await mkdir(constantsDir, {recursive: true});
    const constantsPath = join(constantsDir, file);

    const constants = new Map<string, string>();
    try {
        for (const match of (await readFile(constantsPath, 'utf-8')).matchAll(/static const String (\w+) = '([^']+)';/g)) {
            constants.set(match[1], match[2]);
        }
    } catch {
        // File doesn't exist, that's fine
    }

    const unique = entries.filter((entry, index) => entries.findIndex(other => other.assetPath === entry.assetPath) === index);
    const skipped: WrittenConstants['skipped'] = [];
    for (const entry of unique) {
        const name = lowerCamelCase(entry.nodeName);
        if (isDartIdentifier(name)) constants.set(name, entry.assetPath);
        else skipped.push({...entry, reason: 'not a valid Dart identifier'});
    }
    const names = new Map<string, string>();
    for (const [name, assetPath] of constants) names.set(assetPath, name);
    for (const entry of unique) {
        if (!names.has(entry.assetPath)) skipped.push({...entry, reason: 'another asset has the same name'});
    }

    const body = Array.from(constants.entries()).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, assetPath]) => `  static const String ${name} = '${assetPath}';\n`).join('');
    await writeFile(constantsPath, `// ${title}\n// Do not edit manually\n\nclass ${className} {\n${body}}\n`);
    return {path: constantsPath, className, names: new Map(unique.filter(entry => names.has(entry.assetPath)).map(entry => [entry.assetPath, names.get(entry.assetPath)!])), skipped};
}

export async function generateAssetConstants(assets: Array<{filename: string, nodeName: string}>, projectPath: string): Promise<WrittenConstants> {
    // flutter_gen generates its own `Assets` class; a second one breaks compilation.
    const className = await usesFlutterGen(projectPath) ? 'FigmaAssets' : 'Assets';
    return writeConstants(
        assets.map(asset => ({assetPath: `${defaults.output.imagesDir}/${toMainAssetPath(asset.filename)}`, nodeName: asset.nodeName})),
        projectPath, defaults.output.assetConstantsFile, className, 'Generated asset constants');
}

export async function generateSvgAssetConstants(assets: Array<{filename: string, nodeName: string}>, projectPath: string): Promise<WrittenConstants> {
    return writeConstants(
        assets.map(asset => ({assetPath: `${defaults.output.svgsDir}/${asset.filename}`, nodeName: asset.nodeName})),
        projectPath, defaults.output.svgConstantsFile, 'SvgAssets', 'Generated SVG asset constants');
}

// ── Which nodes to export, and how ──────────────────────────────────────────

/** Flutter's documented device pixel ratios (docs.flutter.dev, resolution-aware image assets). */
export const DEVICE_PIXEL_RATIOS = [1, 1.5, 2, 3, 4];

/** The `devicePixelRatios` input of the PNG export tools; the default comes from defaults.json. */
export const devicePixelRatiosInput = z.array(z.number().refine(ratio => DEVICE_PIXEL_RATIOS.includes(ratio), {message: `must be one of ${DEVICE_PIXEL_RATIOS.join(', ')}`})).min(1).optional()
    .describe(`Device pixel ratios (${DEVICE_PIXEL_RATIOS.join(', ')}) to export PNG at for nodes without exportSettings (default: ${JSON.stringify(defaults.output.devicePixelRatios)})`);

export interface AssetNode {
    id: string;
    name: string;
    node: any;
}

type AssetFormat = 'png' | 'jpg' | 'svg' | 'pdf';

interface AssetRequest {
    node: AssetNode;
    format: AssetFormat;
    scale: number;
}

const hasExportSettings = (node: any): boolean => (node.exportSettings?.length ?? 0) > 0;
const hasImageFill = (node: any): boolean =>
    !!node.fills?.some((fill: any) => fill.type === 'IMAGE' && fill.visible !== false);

/**
 * The nodes to export: every visible descendant with exportSettings or a visible IMAGE fill. A root is exported
 * only when `includeRoots` is set (the IDs the caller passed); the analyse tools export descendants only.
 * No layer name or size decides.
 */
export function selectAssetNodes(roots: any[], includeRoots: boolean): AssetNode[] {
    const found = new Map<string, AssetNode>();
    const visit = (node: any, isRoot: boolean): void => {
        if (!isEffectivelyVisible(node)) return;
        if (isRoot ? includeRoots : hasExportSettings(node) || hasImageFill(node)) {
            found.set(node.id, {id: node.id, name: node.name, node});
        }
        node.children?.forEach((child: any) => visit(child, false));
    };
    roots.forEach(root => visit(root, true));
    return [...found.values()];
}

/** A download error as a few words: the network error code (ENOTFOUND), else the HTTP status; never the URL. */
function downloadFailureReason(error: unknown): string {
    const code = (error as {cause?: {code?: string}})?.cause?.code;
    if (code) return code;
    if (error instanceof ImageDownloadError && error.status !== undefined) return `HTTP ${error.status}`;
    return error instanceof Error ? error.message : String(error);
}

const vectorFormat = (format: AssetFormat): boolean => format === 'svg' || format === 'pdf';

/** The nearest of Flutter's documented ratios. */
const snapToRatio = (ratio: number): number =>
    DEVICE_PIXEL_RATIOS.reduce((best, candidate) => Math.abs(candidate - ratio) < Math.abs(best - ratio) ? candidate : best);

/**
 * What to request for one node. With exportSettings, each setting gives a format and scale (SVG and PDF at 1;
 * WIDTH/HEIGHT become the nearest documented ratio); without, `fallbackFormat` at each device pixel ratio.
 */
function planNode(node: AssetNode, ratios: number[], fallbackFormat: AssetFormat): {requests: AssetRequest[]; notes: string[]} {
    const requests = new Map<string, AssetRequest>();
    const notes: string[] = [];
    const add = (format: AssetFormat, scale: number) => requests.set(`${format}@${scale}`, {node, format, scale});
    const settings: any[] = node.node.exportSettings ?? [];

    if (settings.length === 0) {
        if (fallbackFormat === 'svg' || fallbackFormat === 'pdf') add(fallbackFormat, 1);
        else ratios.forEach(ratio => add(fallbackFormat, ratio));
    }
    for (const setting of settings) {
        const format = String(setting.format).toLowerCase() as AssetFormat;
        if (!['png', 'jpg', 'svg', 'pdf'].includes(format)) {
            notes.push(`${node.name}: export format ${setting.format} is not supported; not exported`);
            continue;
        }
        if (setting.suffix) notes.push(`${node.name}: suffix "${setting.suffix}" is reported, not used in the file name`);
        if (format === 'svg' || format === 'pdf') {
            add(format, 1);
            continue;
        }
        const constraint = setting.constraint;
        if (constraint?.type === 'WIDTH' || constraint?.type === 'HEIGHT') {
            const side = node.node.absoluteBoundingBox?.[constraint.type === 'WIDTH' ? 'width' : 'height'];
            if (!side) {
                notes.push(`${node.name}: ${constraint.type} ${constraint.value} needs an absoluteBoundingBox; not exported`);
                continue;
            }
            const ratio = constraint.value / side;
            const snapped = snapToRatio(ratio);
            notes.push(`${node.name}: ${constraint.type} ${constraint.value} → ${Number(ratio.toFixed(2))}x, exported at ${snapped}x`);
            add(format, snapped);
        } else {
            const value = constraint?.value ?? 1;
            const snapped = snapToRatio(value);
            if (snapped !== value) notes.push(`${node.name}: SCALE ${value} → exported at ${snapped}x`);
            add(format, snapped);
        }
    }
    return {requests: [...requests.values()], notes};
}

export interface ExportedAssets {
    assets: AssetInfo[];
    notes: string[];
    constants: WrittenConstants[];
}

/**
 * Plan, request (one /images call per format and scale), download and register `nodes`: constants and pubspec.
 * PNG and JPG go under the images folder (`N.0x/` variants), SVG and PDF under the SVG folder.
 */
export async function exportAssetNodes(options: {
    figmaService: FigmaService;
    fileId: string;
    projectPath: string;
    nodes: AssetNode[];
    ratios?: number[];
    fallbackFormat?: AssetFormat;
}): Promise<ExportedAssets> {
    const {figmaService, fileId, projectPath, nodes} = options;
    const ratios = options.ratios ?? defaults.output.devicePixelRatios;
    const plans = nodes.map(node => planNode(node, ratios, options.fallbackFormat ?? 'png'));
    const groups = new Map<string, AssetRequest[]>();
    plans.flatMap(plan => plan.requests).forEach(request => {
        const key = `${request.format}@${request.scale}`;
        groups.set(key, [...(groups.get(key) ?? []), request]);
    });

    const assets: AssetInfo[] = [];
    const notes: string[] = [];
    if (groups.size > 0) {
        const imagesDir = await createAssetsDirectory(projectPath);
        const svgsDir = await createSvgAssetsDirectory(projectPath);
        for (const requests of groups.values()) {
            const {format, scale} = requests[0];
            const images = await figmaService.getImageBytes(fileId, requests.map(request => request.node.id), {format, scale});
            for (const {node} of requests) {
                const image = images[node.id];
                if (!image) {
                    notes.push(`${node.name} (${node.id}): Figma returned no image for ${format}${vectorFormat(format) ? '' : ` at ${scale}x`}; not exported`);
                    continue;
                }
                const vector = vectorFormat(format);
                const filename = vector ? generateSvgFilename(node.name).replace(/\.svg$/, `.${format}`) : generateAssetFilename(node.name, format, scale);
                const filepath = join(vector ? svgsDir : imagesDir, filename);
                if (image instanceof ImageDownloadError) {
                    // The agent sees only the tool's text, so the failure goes there; the URL carries a signed token and stays out.
                    notes.push(`${node.name} (${node.id}): download failed for ${format}${vector ? '' : ` at ${scale}x`} (${downloadFailureReason(image)}); not exported`);
                    continue;
                }
                await saveImage(image, filepath);
                assets.push({
                    nodeId: node.id,
                    nodeName: node.name,
                    filename,
                    path: `${vector ? defaults.output.svgsDir : defaults.output.imagesDir}/${filename}`,
                    size: (await getFileStats(filepath)).size
                });
            }
        }
    }

    const constants: WrittenConstants[] = [];
    const raster = assets.filter(asset => !/\.(svg|pdf)$/.test(asset.filename));
    const svg = assets.filter(asset => asset.filename.endsWith('.svg'));
    // Constants first: updatePubspecAssets throws on pubspec shapes it refuses to edit
    if (raster.length > 0) constants.push(await generateAssetConstants(raster, projectPath));
    if (svg.length > 0) constants.push(await generateSvgAssetConstants(svg, projectPath));
    if (assets.length > 0) await updatePubspecAssets(join(projectPath, 'pubspec.yaml'), assets);

    return {assets, notes: [...plans.flatMap(plan => plan.notes), ...notes], constants};
}
