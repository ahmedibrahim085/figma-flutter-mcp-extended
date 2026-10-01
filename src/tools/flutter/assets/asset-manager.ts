// tools/flutter/asset-manager.mts
import {existsSync} from 'fs';
import {writeFile, mkdir, readFile} from 'fs/promises';
import {join, dirname} from 'path';
import {detectConstantsDir} from '../../../utils/project-conventions.js';
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
function toMainAssetPath(path: string): string {
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

export async function downloadImage(url: string, filepath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await mkdir(dirname(filepath), {recursive: true});
    await writeFile(filepath, Buffer.from(buffer));
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
    let pubspecContent: string;

    try {
        pubspecContent = await readFile(pubspecPath, 'utf-8');
    } catch {
        // If pubspec doesn't exist, create a basic one
        pubspecContent = `name: flutter_app
description: A Flutter application

version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter

dev_dependencies:
  flutter_test:
    sdk: flutter

flutter:
  uses-material-design: true
`;
    }

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

const DART_RESERVED = new Set([
    'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export', 'extends', 'extension',
    'external', 'factory', 'false', 'final', 'finally', 'for', 'get', 'if', 'implements', 'import', 'in',
    'interface', 'is', 'late', 'library', 'mixin', 'new', 'null', 'operator', 'part', 'required', 'rethrow',
    'return', 'set', 'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef', 'var',
    'void', 'while', 'with', 'yield',
]);

/** lowerCamelCase Dart identifier; leading digits get `prefix`, reserved words a trailing `_`. */
function toDartIdentifier(name: string, prefix: string): string {
    let identifier = toCamelCase(name) || prefix;
    if (/^\d/.test(identifier)) {
        identifier = prefix + identifier.charAt(0).toUpperCase() + identifier.slice(1);
    }
    return DART_RESERVED.has(identifier) ? `${identifier}_` : identifier;
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

export async function generateAssetConstants(assets: Array<{filename: string, nodeName: string}>, projectPath: string): Promise<string> {
    const constantsDir = await detectConstantsDir(projectPath);
    await mkdir(constantsDir, {recursive: true});

    const constantsPath = join(constantsDir, defaults.output.assetConstantsFile);

    // Read existing constants if they exist
    const existingConstants = new Map<string, string>();
    try {
        const existingContent = await readFile(constantsPath, 'utf-8');
        // Extract existing constants using regex
        const constantMatches = existingContent.matchAll(/static const String (\w+) = '([^']+)';/g);
        for (const match of constantMatches) {
            existingConstants.set(match[1], match[2]);
        }
    } catch {
        // File doesn't exist, that's fine
    }

    // Generate unique asset names from new assets
    const uniqueAssets = assets.reduce((acc, asset) => {
        const mainFilename = toMainAssetPath(asset.filename);
        if (!acc[mainFilename]) {
            acc[mainFilename] = asset;
        }
        return acc;
    }, {} as Record<string, any>);

    // Add new constants to existing ones
    Object.entries(uniqueAssets).forEach(([mainFilename, asset]) => {
        const constantName = toDartIdentifier(asset.nodeName, 'image');
        existingConstants.set(constantName, `${defaults.output.imagesDir}/${mainFilename}`);
    });

    // flutter_gen generates its own `Assets` class; a second one breaks compilation.
    const className = await usesFlutterGen(projectPath) ? 'FigmaAssets' : 'Assets';

    // Generate the complete constants file
    let constantsContent = `// Generated asset constants\n// Do not edit manually\n\nclass ${className} {\n`;

    // Sort constants alphabetically for consistency
    const sortedConstants = Array.from(existingConstants.entries()).sort(([a], [b]) => a.localeCompare(b));
    sortedConstants.forEach(([constantName, assetPath]) => {
        constantsContent += `  static const String ${constantName} = '${assetPath}';\n`;
    });

    constantsContent += `}\n`;

    await writeFile(constantsPath, constantsContent);
    return constantsPath;
}

export async function generateSvgAssetConstants(assets: Array<{filename: string, nodeName: string}>, projectPath: string): Promise<string> {
    const constantsDir = await detectConstantsDir(projectPath);
    await mkdir(constantsDir, {recursive: true});

    const constantsPath = join(constantsDir, defaults.output.svgConstantsFile);

    // Read existing SVG constants if they exist
    const existingConstants = new Map<string, string>();
    try {
        const existingContent = await readFile(constantsPath, 'utf-8');
        // Extract existing constants using regex
        const constantMatches = existingContent.matchAll(/static const String (\w+) = '([^']+)';/g);
        for (const match of constantMatches) {
            existingConstants.set(match[1], match[2]);
        }
    } catch {
        // File doesn't exist, that's fine
    }

    // Generate unique SVG asset names from new assets
    const uniqueAssets = assets.reduce((acc, asset) => {
        const baseName = asset.filename.replace(/\.svg$/, '');
        if (!acc[baseName]) {
            acc[baseName] = asset;
        }
        return acc;
    }, {} as Record<string, any>);

    // Add new constants to existing ones
    Object.entries(uniqueAssets).forEach(([baseName, asset]) => {
        const constantName = toDartIdentifier(asset.nodeName, 'svg');
        const assetPath = `${defaults.output.svgsDir}/${baseName}.svg`;
        existingConstants.set(constantName, assetPath);
    });

    // Generate the complete SVG constants file
    let constantsContent = `// Generated SVG asset constants\n// Do not edit manually\n\nclass SvgAssets {\n`;

    // Sort constants alphabetically for consistency
    const sortedConstants = Array.from(existingConstants.entries()).sort(([a], [b]) => a.localeCompare(b));
    sortedConstants.forEach(([constantName, assetPath]) => {
        constantsContent += `  static const String ${constantName} = '${assetPath}';\n`;
    });

    constantsContent += `}\n`;

    await writeFile(constantsPath, constantsContent);
    return constantsPath;
}

export function groupAssetsByBaseName(assets: Array<{filename: string, nodeName: string, size: string}>): Record<string, Array<{filename: string, size: string}>> {
    return assets.reduce((acc, asset) => {
        const baseName = toMainAssetPath(asset.filename).replace(/\.[^.]+$/, '');
        if (!acc[baseName]) {
            acc[baseName] = [];
        }
        acc[baseName].push({
            filename: asset.filename,
            size: asset.size
        });
        return acc;
    }, {} as Record<string, Array<{filename: string, size: string}>>);
}

function toCamelCase(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .replace(/_(.)/g, (_, char) => char.toUpperCase());
}
