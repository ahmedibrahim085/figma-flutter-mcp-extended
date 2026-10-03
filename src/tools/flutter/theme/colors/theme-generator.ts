// src/tools/flutter/simple-theme-generator.mts
import {writeFile, mkdir} from 'fs/promises';
import {join} from 'path';
import type {ThemeColor, ThemeGenerationOptions} from '../../../../extractors/colors/index.js';
import defaults from '../../../../defaults.json' with { type: 'json' };
import {dartColor} from '../../../../utils/dart-color.js';
import {nameConstants} from '../../../../utils/dart-names.js';

export interface ThemeConstants {
    /** Colours that get a constant, in frame order, with its name. */
    generated: Array<{color: ThemeColor; name: string}>;
    /** Colours that get none, with the reason. */
    skipped: Array<{color: ThemeColor; reason: string}>;
}

/** Dart constants for the colours, named by the shared rule in `nameConstants`. */
export function themeConstants(colors: ThemeColor[]): ThemeConstants {
    const {generated, skipped} = nameConstants(colors, color => dartColor(color.fill), 'color');
    return {
        generated: generated.map(({item, name}) => ({color: item, name})),
        skipped: skipped.map(({item, reason}) => ({color: item, reason})),
    };
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
