/** `Brand/Primary` → `brandPrimary`: split on anything but letters and digits; a word keeps its inner capitals unless it is all capitals. */
export function lowerCamelCase(name: string): string {
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
export const isDartIdentifier = (name: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !DART_RESERVED_WORDS.has(name);

/** `Button / Primary` → `ButtonPrimary`: `lowerCamelCase` with the first letter capitalised, as Dart names types. */
export function typeName(name: string): string {
    const camel = lowerCamelCase(name);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
}

// Of Dart's words that cannot name a type (https://dart.dev/language/keywords), `Function` is the only one UpperCamelCase can spell.
export const isDartTypeName = (name: string) => isDartIdentifier(name) && name !== 'Function';

export interface DartConstants<T> {
    /** Items that get a constant, in frame order, with its name. */
    generated: Array<{item: T; name: string}>;
    /** Items that get none, with the reason. */
    skipped: Array<{item: T; reason: string}>;
}

/**
 * Dart constant names for items named like Figma styles: the last "/" segment of each name, or the
 * full path when that segment is not a valid identifier or another name shares it. An item whose
 * full path is still not valid, or that another item of a different `valueKey` shares, is skipped.
 * The same name and value twice gives one constant. `noun` words the skip reason ("color", "style").
 */
export function nameConstants<T extends {name: string}>(items: T[], valueKey: (item: T) => string | undefined, noun: string): DartConstants<T> {
    const unique = items.filter((item, index) =>
        items.findIndex(other => other.name === item.name && valueKey(other) === valueKey(item)) === index);
    const leaves = unique.map(item => lowerCamelCase(item.name.split('/').pop() ?? ''));
    const named = unique.map((item, index) => {
        const leaf = leaves[index];
        const name = isDartIdentifier(leaf) && leaves.filter(other => other === leaf).length === 1 ? leaf : lowerCamelCase(item.name);
        return {item, name};
    });

    const generated: DartConstants<T>['generated'] = [];
    const skipped: DartConstants<T>['skipped'] = [];
    for (const entry of named) {
        if (!isDartIdentifier(entry.name)) {
            skipped.push({item: entry.item, reason: 'not a valid Dart identifier'});
        } else if (named.some(other => other !== entry && other.name === entry.name)) {
            skipped.push({item: entry.item, reason: `another ${noun} has the same name`});
        } else {
            generated.push(entry);
        }
    }
    return {generated, skipped};
}
