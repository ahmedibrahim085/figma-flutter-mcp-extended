// src/tools/flutter/typography-generator.mts

import {mkdir, writeFile} from 'fs/promises';
import {join} from 'path';
import type {TypographyStyle} from '../../../../extractors/typography/types.js';
import {textStyleCode} from '../../../../extractors/flutter/text-style.js';
import {lowerCamelCase, nameConstants} from '../../../../utils/dart-names.js';
import defaults from '../../../../defaults.json' with { type: 'json' };

export interface TypographyConstants {
    /** Styles that get a constant, in frame order, with its name. */
    generated: Array<{style: TypographyStyle; name: string}>;
    /** Styles that get none, with the reason. */
    skipped: Array<{style: TypographyStyle; reason: string}>;
    /** TextTheme slots filled, in the order Flutter lists them, with the constant each points to. */
    slots: Array<{slot: string; name: string}>;
    /** Slots that two or more generated styles equal: left unfilled, so the result does not depend on layer order. */
    slotClashes: Array<{slot: string; styles: TypographyStyle[]}>;
}

/**
 * Dart constants for the styles, named by the shared rule in `nameConstants`. A TextTheme slot is
 * filled by the style whose full name in lowerCamelCase equals the slot's name, so the match does
 * not depend on the constant's name or on the other styles.
 */
export function typographyConstants(styles: TypographyStyle[]): TypographyConstants {
    const {generated, skipped} = nameConstants(styles, style => JSON.stringify(style.fields), 'style');
    const bySlot = new Map<string, Array<{style: TypographyStyle; name: string}>>();
    for (const {item, name} of generated) {
        const slot = lowerCamelCase(item.name);
        if (defaults.textThemeSlots.includes(slot)) bySlot.set(slot, [...(bySlot.get(slot) ?? []), {style: item, name}]);
    }
    return {
        generated: generated.map(({item, name}) => ({style: item, name})),
        skipped: skipped.map(({item, reason}) => ({style: item, reason})),
        slots: defaults.textThemeSlots.filter(slot => bySlot.get(slot)?.length === 1).map(slot => ({slot, name: bySlot.get(slot)![0].name})),
        slotClashes: [...bySlot].filter(([, entries]) => entries.length > 1).map(([slot, entries]) => ({slot, styles: entries.map(entry => entry.style)})),
    };
}

/**
 * Flutter typography generator for AppText classes
 */
export class TypographyGenerator {
    /**
     * Generate AppText class from the styles' constants, and the TextTheme when asked and a slot is filled.
     * Returns the AppText path.
     */
    async generateAppText(constants: TypographyConstants, outputDir: string, generateTextTheme: boolean): Promise<string> {
        await mkdir(outputDir, {recursive: true});

        const appTextPath = join(outputDir, defaults.output.textStylesFile);
        await writeFile(appTextPath, this.generateAppTextClass(constants));

        if (generateTextTheme && constants.slots.length > 0) {
            await writeFile(join(outputDir, defaults.output.textThemeFile), this.generateTextThemeClass(constants));
        }

        return appTextPath;
    }

    private generateAppTextClass(constants: TypographyConstants): string {
        let content = this.generateFileHeader('AppText - Typography styles for the app');
        content += `import 'package:flutter/material.dart';\n\n`;
        content += `/// Typography styles for the app\n`;
        content += `/// Generated from Figma design system\n`;
        content += `class AppText {\n`;
        content += `  AppText._();\n\n`;

        constants.generated.forEach(({style, name}) => {
            // A layer name may hold a line break, which would end the comment.
            content += `  /// ${style.name.replace(/\s+/g, ' ')}\n`;
            content += `  static const TextStyle ${name} = ${textStyleCode(style.fields)};\n\n`;
        });

        content += '}\n';
        return content;
    }

    private generateTextThemeClass(constants: TypographyConstants): string {
        let content = this.generateFileHeader('TextTheme - Material Design text theme');
        content += "import 'package:flutter/material.dart';\n";
        content += `import '${defaults.output.textStylesFile}';\n\n`;
        content += `/// Material Design text theme\n`;
        content += `/// Generated from Figma design system\n`;
        content += `class AppTextTheme {\n`;
        content += `  AppTextTheme._();\n\n`;
        content += `  /// Get Material Design text theme\n`;
        content += `  static TextTheme get textTheme {\n`;
        content += `    return TextTheme(\n`;
        constants.slots.forEach(({slot, name}) => {
            content += `      ${slot}: AppText.${name},\n`;
        });
        content += `    );\n`;
        content += `  }\n`;
        content += '}\n';
        return content;
    }

    private generateFileHeader(description: string): string {
        const timestamp = new Date().toISOString();
        return `// ${description}\n// Generated on ${timestamp}\n// This file was automatically generated from Figma design system\n\n`;
    }
}
