import labels from '../labels.json' with {type: 'json'};

/**
 * The text `labels[group][key]` from src/labels.json with each `{name}` replaced by `values.name`. A key the file lacks, or a
 * placeholder with no value, throws: a missing label must fail a test, not print `{path}` to a client.
 */
export function label<G extends keyof typeof labels>(group: G, key: keyof (typeof labels)[G] & string, values: Record<string, string | number> = {}): string {
    const text = (labels[group] as Record<string, string>)[key];
    if (text === undefined) throw new Error(`No label ${group}.${key} in src/labels.json`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => {
        if (!(name in values)) throw new Error(`Label ${group}.${key} needs a value for {${name}}`);
        return String(values[name]);
    });
}
