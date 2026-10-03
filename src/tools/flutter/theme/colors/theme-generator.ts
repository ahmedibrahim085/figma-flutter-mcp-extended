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

/**
 * Dart constant names for the colours: the last "/" segment of each name, or the full path
 * for every name whose last segment another name shares.
 */
// SHORTCUT: two swatches with an identical full path still collide; make them unique if designs name two swatches alike.
export function constantNames(colors: ThemeColor[]): string[] {
    const leaves = colors.map(color => lowerCamelCase(color.name.split('/').pop() ?? ''));
    return colors.map((color, index) =>
        leaves.filter(leaf => leaf === leaves[index]).length > 1 ? lowerCamelCase(color.name) : leaves[index]);
}

export class SimpleThemeGenerator {
    /**
     * Generate AppColors Dart class from theme colors
     */
    async generateAppColors(colors: ThemeColor[], outputPath: string, options: ThemeGenerationOptions = {}): Promise<string> {
        // Create output directory
        await mkdir(outputPath, {recursive: true});
        const filePath = join(outputPath, defaults.output.colorsFile);

        // Generate Dart content
        const content = this.generateDartContent(colors);

        await writeFile(filePath, content);

        // Generate ThemeData if requested
        if (options.generateThemeData) {
            await this.generateThemeData(colors, outputPath, options);
        }

        return filePath;
    }

    /**
     * Generate Flutter ThemeData from theme colors
     */
    async generateThemeData(colors: ThemeColor[], outputPath: string, options: ThemeGenerationOptions = {}): Promise<string> {
        const filePath = join(outputPath, defaults.output.themeFile);
        const content = this.generateThemeDataContent(colors, options);

        await writeFile(filePath, content);
        return filePath;
    }

    private generateDartContent(colors: ThemeColor[]): string {

        let content = `// Generated AppColors from a Figma frame of color samples

import 'package:flutter/material.dart';

class AppColors {
`;

        // Generate color constants
        const names = constantNames(colors);
        colors.forEach((color, index) => {
            content += `  /// ${color.name}
  static const Color ${names[index]} = ${dartColor(color.fill)};

`;
        });

        content += `}\n`;
        return content;
    }

    private generateThemeDataContent(colors: ThemeColor[], options: ThemeGenerationOptions): string {
        const names = new Set(constantNames(colors));
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
