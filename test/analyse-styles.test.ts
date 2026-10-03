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
const STYLE_ID = /\b(?:decoration|padding|text|layout)[A-Z0-9][a-z0-9]{11}\b/g;

for (const [file, nodeId] of FIXTURES) {
    test(`${file}: every style id the analyse code uses has its definition in the report`, async () => {
        const json = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf-8'));
        const {text} = await callToolOffline({[`/files/${FILE_KEY}/nodes?ids=${nodeId}`]: {body: json}}, 'analyze_figma_component',
            {input: FILE_KEY, nodeId, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true});

        const classes = text.match(/^class [\s\S]*?^}$/gm) ?? [];
        const used = new Set(classes.flatMap((code) => code.match(STYLE_ID) ?? []));
        const defined = new Set([...text.matchAll(/^final (\w+) = /gm)].map((match) => match[1]));
        assert.ok(used.size > 0, `the fixture's code uses no style, so the test proves nothing:\n${text}`);
        assert.deepEqual([...used].filter((id) => !defined.has(id)), [], 'style ids used without a definition');
    });
}
