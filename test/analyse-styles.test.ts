// analyze_figma_component with generateFlutterCode prints, in the same report, the definition of every style its code refers to.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {callToolOffline, FILE_KEY} from './helpers/offline-tool.ts';

const FIXTURES: Array<[file: string, nodeId: string]> = [
    ['paints-frame.json', '1:20'],
    ['component-button-set.json', '1:64'],
    ['layout-frame.json', '1:34'],
    ['text-frame.json', '1:8'],
];
/**
 * The style ids a class block uses as values (`decoration: decorationX,`): any lowercase category prefix followed by the
 * 12-character content id (decision 28), so a new style category is seen too. Only a value after `: ` counts, which keeps
 * Dart fields and keywords (`mainAxisSize: MainAxisSize.min`) out.
 */
const usedStyleIds = (code: string) => code.match(/(?<=: )[a-z]+[A-Z0-9][a-z0-9]{11}(?=[,)])/g) ?? [];

test('usedStyleIds sees an id of a category it does not know, and not Dart fields', () => {
    const code = 'class A extends StatelessWidget {\n  Widget build(BuildContext context) => Container(\n    shadow: shadowAb12cd34ef56,\n    mainAxisSize: MainAxisSize.min,\n    crossAxisAlignment: CrossAxisAlignment.start,\n  );\n}';

    assert.deepEqual(usedStyleIds(code), ['shadowAb12cd34ef56']);
});

for (const [file, nodeId] of FIXTURES) {
    test(`${file}: every style id the analyse code uses has its definition in the report`, async () => {
        const json = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf-8'));
        const {text} = await callToolOffline({[`/files/${FILE_KEY}/nodes?ids=${nodeId}`]: {body: json}}, 'analyze_figma_component',
            {input: FILE_KEY, nodeId, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true});

        const classes = text.match(/^class [\s\S]*?^}$/gm) ?? [];
        const used = new Set(classes.flatMap(usedStyleIds));
        const defined = new Set([...text.matchAll(/^final (\w+) = /gm)].map((match) => match[1]));
        assert.ok(used.size > 0, `the fixture's code uses no style, so the test proves nothing:\n${text}`);
        assert.deepEqual([...used].filter((id) => !defined.has(id)), [], 'style ids used without a definition');
    });
}
