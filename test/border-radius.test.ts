// One BorderRadius emitter: every tool that prints a radius prints it from Figma's corner numbers, clockwise from the
// top left (rectangleCornerRadii: topLeft, topRight, bottomRight, bottomLeft), and leaves zero corners out.
// Expected strings are written by hand from Flutter's BorderRadius.circular and BorderRadius.only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

const RADII: Array<{name: string; corners: object; dart: string}> = [
    {name: 'one radius', corners: {cornerRadius: 8}, dart: 'BorderRadius.circular(8)'},
    {name: 'four different corners', corners: {rectangleCornerRadii: [4, 8, 12, 16]},
        dart: 'BorderRadius.only(topLeft: Radius.circular(4), topRight: Radius.circular(8), bottomRight: Radius.circular(12), bottomLeft: Radius.circular(16))'},
    {name: 'a zero radius', corners: {cornerRadius: 0}, dart: ''},
    {name: 'a zero corner', corners: {rectangleCornerRadii: [12, 0, 12, 0]},
        dart: 'BorderRadius.only(topLeft: Radius.circular(12), bottomRight: Radius.circular(12))'},
];

const frame = (corners: object) => ({
    id: '60:1', name: 'Card', type: 'FRAME', layoutMode: 'VERTICAL', ...corners,
    fills: [{type: 'SOLID', color: {r: 1, g: 0, b: 0, a: 1}}],
    absoluteBoundingBox: {x: 0, y: 0, width: 100, height: 100},
    children: [],
});

for (const {name, corners, dart} of RADII) {
    test(`style definitions print ${name} as ${dart}`, async () => {
        const node = frame(corners);
        const {text} = await callToolOffline(nodeRoute(node.id, node), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: node.id});

        assert.equal(text.includes('borderRadius:'), dart !== '', text);
        if (dart) assert.ok(text.includes(`  borderRadius: ${dart},\n`), text);
    });

    test(`the analysis report's style definitions print ${name} as ${dart}`, async () => {
        const node = frame(corners);
        const {text} = await callToolOffline(nodeRoute(node.id, node), 'analyze_figma_component',
            {input: FILE_KEY, nodeId: node.id, exportAssets: false, userDefinedComponent: true, generateFlutterCode: true});

        assert.equal(text.includes('borderRadius:'), dart !== '', text);
        if (dart) assert.ok(text.includes(`  borderRadius: ${dart},\n`), text);
    });
}
