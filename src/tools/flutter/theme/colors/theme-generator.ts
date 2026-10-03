// src/tools/flutter/simple-theme-generator.mts
import {writeFile, mkdir} from 'fs/promises';
import {join} from 'path';
import type {ThemeColor, ThemeGenerationOptions} from '../../../../extractors/colors/index.js';
import defaults from '../../../../defaults.json' with { type: 'json' };
import {dartColor} from '../../../../utils/dart-color.js';

/** `Brand/Primary` → `brandPrimary`: split on anything but letters and digits; a word keeps its inner capitals unless it is all capitals. */
function lowerCamelCase(name: string): string {
    return name
        .split(/[^A-Za-z0-9]+/)
        .filter(word => word.length > 0)
        .map(word => word === word.toUpperCase() ? word.toLowerCase() : word)
        .map((word, index) => index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
}

// Dart's reserved words: https://dart.dev/language/keywords (built-in identifiers may be field names).
const DART_RESERVED_WORDS = new Set([
    'assert', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'do', 'else', 'enum', 'extends',
    'false', 'final', 'finally', 'for', 'if', 'in', 'is', 'new', 'null', 'rethrow', 'return', 'super', 'switch',
    'this', 'throw', 'true', 'try', 'var', 'void', 'while', 'with',
]);
const isDartIdentifier = (name: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !DART_RESERVED_WORDS.has(name);

export interface ThemeConstants {
    /** Colours that get a constant, in frame order, with its name. */
    generated: Array<{color: ThemeColor; name: string}>;
    /** Colours that get none, with the reason. */
    skipped: Array<{color: ThemeColor; reason: string}>;
}

/**
 * Dart constants for the colours: the last "/" segment of each name, or the full path when that
 * segment is not a valid identifier or another name shares it. A colour whose full path is still
 * not valid, or that another colour of a different value shares, is skipped. The same name and
 * colour twice gives one constant.
 */
export function themeConstants(colors: ThemeColor[]): ThemeConstants {
    const unique = colors.filter((color, index) =>
        colors.findIndex(other => other.name === color.name && dartColor(other.fill) === dartColor(color.fill)) === index);
    const leaves = unique.map(color => lowerCamelCase(color.name.split('/').pop() ?? ''));
    const named = unique.map((color, index) => {
        const leaf = leaves[index];
        const name = isDartIdentifier(leaf) && leaves.filter(other => other === leaf).length === 1 ? leaf : lowerCamelCase(color.name);
        return {color, name};
    });

    const generated: ThemeConstants['generated'] = [];
    const skipped: ThemeConstants['skipped'] = [];
    for (const entry of named) {
        if (!isDartIdentifier(entry.name)) {
            skipped.push({color: entry.color, reason: 'not a valid Dart identifier'});
        } else if (named.some(other => other !== entry && other.name === entry.name)) {
            skipped.push({color: entry.color, reason: 'another color has the same name'});
        } else {
            generated.push(entry);
        }
    }
    return {generated, skipped};
}

export class SimpleThemeGenerator {
    /**
     * Generate AppColors Dart class from the theme's constants
     */
    async generateAppColors(constants: ThemeConstants, outputPath: string, options: ThemeGenerationOptions = {}): Promise<string> {
        // Create output directory
        await mkdir(outputPath, {recursive: true});
        const filePath = join(outputPath, defaults.output.colorsFile);

        // Generate Dart content
        const content = this.generateDartContent(constants);

        await writeFile(filePath, content);

        // Generate ThemeData if requested
        if (options.generateThemeData) {
            await this.generateThemeData(constants, outputPath, options);
        }

        return filePath;
    }

    /**
     * Generate Flutter ThemeData from the theme's constants
     */
    async generateThemeData(constants: ThemeConstants, outputPath: string, options: ThemeGenerationOptions = {}): Promise<string> {
        const filePath = join(outputPath, defaults.output.themeFile);
        const content = this.generateThemeDataContent(constants, options);

        await writeFile(filePath, content);
        return filePath;
    }

    private generateDartContent(constants: ThemeConstants): string {

        let content = `// Generated AppColors from a Figma frame of color samples

import 'package:flutter/material.dart';

class AppColors {
`;

        // Generate color constants
        constants.generated.forEach(({color, name}) => {
            content += `  /// ${color.name}
  static const Color ${name} = ${dartColor(color.fill)};

`;
        });

        content += `}\n`;
        return content;
    }

    private generateThemeDataContent(constants: ThemeConstants, options: ThemeGenerationOptions): string {
        const names = new Set(constants.generated.map(({name}) => name));
        // Without a colour named primary there is no seed: no ColorScheme, so the theme needs no AppColors.
        const colorScheme = options.includeColorScheme !== false && names.has('primary') ? this.generateColorScheme(names) : '';

        return `// Generated Flutter ThemeData from a Figma frame of color samples

import 'package:flutter/material.dart';
${colorScheme ? `import '${defaults.output.colorsFile}';\n` : ''}
class AppTheme {
  // Light Theme
  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
${colorScheme}    );
  }
}
`;
    }

    /** fromSeed generates every role; only the roles named exactly like a ColorScheme field are set. */
    private generateColorScheme(names: Set<string>): string {
        const roles = defaults.colorSchemeRoles.filter(role => names.has(role));
        // brightness goes on the ColorScheme only: ThemeData asserts the two agree.
        const brightness = names.has('surface')
            ? `        brightness: ThemeData.estimateBrightnessForColor(AppColors.surface),\n`
            : '';
        return `      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.primary,
${brightness}${roles.map(role => `        ${role}: AppColors.${role},\n`).join('')}      ),
`;
    }
}
