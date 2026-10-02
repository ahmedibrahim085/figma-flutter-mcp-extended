import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';
import {withServer} from './helpers/mcp-stdio.ts';

// Material 3 breakpoints (ticket 13, decision 12). Width: Compact <600, Medium 600-839, Expanded 840-1199,
// Large 1200-1599, Extra-large >=1600. Height: Compact <480, Medium 480-899, Expanded >=900. Lower bounds inclusive.
// The expected values are written here, not read from src/defaults.json.
const frameOf = (width?: number, height?: number) => ({
    id: '70:1', name: 'Home', type: 'FRAME',
    ...(width === undefined ? {} : {absoluteBoundingBox: {x: 0, y: 0, width, height}}),
    children: [{id: '70:2', name: 'Body', type: 'FRAME', absoluteBoundingBox: {x: 0, y: 0, width: 10, height: 10}}],
});
const TOOLS = [['analyze_frame_as_screen', {extractAssets: false}], ['inspect_frame_structure', {}]] as const;

async function reports(width?: number, height?: number) {
    const node = frameOf(width, height);
    return Promise.all(TOOLS.map(async ([tool, args]) =>
        [tool, (await callToolOffline(nodeRoute(node.id, node), tool, {input: FILE_KEY, nodeId: node.id, ...args})).text] as const));
}

const widthClass = (text: string) => text.match(/^Material 3 width breakpoint: (\S+) \((\d+) px\)$/m)?.slice(1);
const heightClass = (text: string) => text.match(/^Material 3 height breakpoint: (\S+) \((\d+) px\)$/m)?.slice(1);

test('a 390x844 frame is Compact wide and Medium tall, identically in both tools', async () => {
    for (const [tool, text] of await reports(390, 844)) {
        assert.deepEqual(widthClass(text), ['Compact', '390'], tool);
        assert.deepEqual(heightClass(text), ['Medium', '844'], tool);
        assert.match(text, /^Orientation: portrait$/m, tool);
        assert.match(text, /frame's size in Figma px/, tool);
        assert.doesNotMatch(text, /Device|mobile|tablet|desktop/i, tool);
    }
});

for (const [below, atBound, lowName, highName] of [
    [599, 600, 'Compact', 'Medium'], [839, 840, 'Medium', 'Expanded'], [1199, 1200, 'Expanded', 'Large'], [1599, 1600, 'Large', 'Extra-large'],
] as const) {
    test(`width ${below} is ${lowName} and width ${atBound} is ${highName}, in both tools`, async () => {
        for (const [tool, text] of await reports(below, 700)) assert.equal(widthClass(text)?.[0], lowName, `${tool} at ${below}`);
        for (const [tool, text] of await reports(atBound, 700)) assert.equal(widthClass(text)?.[0], highName, `${tool} at ${atBound}`);
    });
}

for (const [below, atBound, lowName, highName] of [[479, 480, 'Compact', 'Medium'], [899, 900, 'Medium', 'Expanded']] as const) {
    test(`height ${below} is ${lowName} and height ${atBound} is ${highName}, in both tools`, async () => {
        for (const [tool, text] of await reports(390, below)) assert.equal(heightClass(text)?.[0], lowName, `${tool} at ${below}`);
        for (const [tool, text] of await reports(390, atBound)) assert.equal(heightClass(text)?.[0], highName, `${tool} at ${atBound}`);
    });
}

test('a very tall frame (390x5000) is height Expanded, never a larger class', async () => {
    for (const [tool, text] of await reports(390, 5000)) assert.deepEqual(heightClass(text), ['Expanded', '5000'], tool);
});

test('a frame without a bounding box prints no breakpoint, orientation or 0x0 line', async () => {
    for (const [tool, text] of await reports(undefined)) {
        assert.doesNotMatch(text, /breakpoint|^Orientation:|0×0/m, tool);
        assert.match(text, /Node ID: 70:1/, tool);
    }
});

test('equal sides are portrait; wider than tall is landscape', async () => {
    for (const [tool, text] of await reports(600, 600)) assert.match(text, /^Orientation: portrait$/m, tool);
    for (const [tool, text] of await reports(800, 600)) assert.match(text, /^Orientation: landscape$/m, tool);
});

test('analyze_frame_as_screen no longer takes the unused deviceTypeDetection input', async () => {
    let properties: Record<string, unknown> = {};
    await withServer(async (s) => {
        await s.initialize();
        const list: any = await s.request('tools/list');
        properties = list.result.tools.find((t: any) => t.name === 'analyze_frame_as_screen').inputSchema.properties;
    });

    assert.ok('maxChildNodes' in properties);
    assert.ok(!('deviceTypeDetection' in properties));
});
