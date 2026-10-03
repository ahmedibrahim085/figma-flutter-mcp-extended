import {dirname, join, relative, sep} from 'path';
import {detectProjectName} from '../../../utils/project-conventions.js';
import {toMainAssetPath, type AssetInfo, type ExportedAssets, type WrittenConstants} from './asset-manager.js';

/**
 * The part of an asset report that tells the reader how to use the files: built only from what the constants
 * writers wrote (path, class, constant names) and the package name in pubspec.yaml, so every line compiles.
 */
export async function assetUsageReport(assets: AssetInfo[], constants: WrittenConstants[], projectPath: string): Promise<string> {
    const folders = [...new Set(assets.map(asset => dirname(toMainAssetPath(asset.path))))];
    const packageName = await detectProjectName(projectPath);
    const libDir = join(projectPath, 'lib');
    const nodeNameOf = (assetPath: string) => assets.find(asset => toMainAssetPath(asset.path) === assetPath)?.nodeName ?? '';

    let report = `Asset folders (declared in pubspec.yaml): ${folders.join(', ')}\n`;
    if (constants.length > 0) {
        report += `Asset constants written to: ${constants.map(file => relative(projectPath, file.path)).join(', ')}\n`;
        report += packageName
            ? constants.map(file => `Import: import 'package:${packageName}/${relative(libDir, file.path).split(sep).join('/')}';\n`).join('')
            : `Import: pubspec.yaml has no name: line, so the package: import cannot be written.\n`;
    }

    const usage = constants.flatMap(file => [...file.names].map(([assetPath, name]) =>
        `  ${assetPath.endsWith('.svg') ? 'SvgPicture' : 'Image'}.asset(${file.className}.${name}) // ${nodeNameOf(assetPath)}\n`));
    if (usage.length > 0) report += `Usage:\n${usage.join('')}`;
    if (constants.some(file => [...file.names.keys()].some(assetPath => assetPath.endsWith('.svg')))) {
        report += `Import: import 'package:flutter_svg/flutter_svg.dart'; (flutter_svg provides SvgPicture; run \`flutter pub add flutter_svg\`)\n`;
    }

    const skipped = constants.flatMap(file => file.skipped);
    if (skipped.length > 0) {
        report += `No constant (file still written):\n${skipped.map(entry => `  - ${entry.nodeName} (${entry.assetPath}): ${entry.reason}\n`).join('')}`;
    }
    const pdfs = assets.filter(asset => asset.filename.endsWith('.pdf'));
    if (pdfs.length > 0) report += `PDF (path only, no constant): ${pdfs.map(asset => asset.path).join(', ')}\n`;
    return report;
}

/**
 * The asset section the analyse tools append to their report: what was exported (each file by its project path),
 * the export notes, and the usage report. `title` heads the box.
 */
export async function analyseAssetSection(exported: ExportedAssets, projectPath: string, title: string): Promise<string> {
    const notes = exported.notes.map(note => `   • ${note}\n`).join('');
    if (exported.assets.length === 0) return notes ? `\nExport notes:\n${notes}` : '';

    const rule = '='.repeat(50);
    let report = `\n${rule}\n🖼️  ${title}\n${rule}\n\n`;
    report += `Found and exported ${exported.assets.length} asset(s):\n\n`;
    report += exported.assets.map(asset => `   • ${asset.path} (${asset.size})\n`).join('');
    if (notes) report += `\nExport notes:\n${notes}`;
    report += `\n${await assetUsageReport(exported.assets, exported.constants, projectPath)}`;
    return `${report}\n${rule}\n`;
}
