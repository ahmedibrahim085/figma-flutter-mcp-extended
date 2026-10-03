import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

// Variants come from Figma: the axes and defaults are componentPropertyDefinitions (ticket 08).
// Expected values are written here, not read from the code.
const SET_ID = '1:86';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/component-button-set.json', import.meta.url), 'utf-8'));
const findNode = (node: any, id: string): any => node.id === id ? node : (node.children ?? []).map((c: any) => findNode(c, id)).find(Boolean);
const buttonSet = (defaults: {size?: string; state?: string} = {}) => {
    const set = structuredClone(findNode(fixture.nodes['1:64'].document, SET_ID));
    if (defaults.size) set.componentPropertyDefinitions.Size.defaultValue = defaults.size;
    if (defaults.state) set.componentPropertyDefinitions.State.defaultValue = defaults.state;
    return set;
};
const args = {input: FILE_KEY, nodeId: SET_ID};
const list = (set: any) => callToolOffline(nodeRoute(set.id, set), 'list_component_variants', args);
const analyze = (set: any, extra: object = {}) =>
    callToolOffline(nodeRoute(set.id, set), 'analyze_figma_component', {...args, exportAssets: false, ...extra});
const defaultMarks = (text: string) => [...text.matchAll(/^\d+\. (.+) \(default\)$/gm)].map((m) => m[1]);

test('A13: with Figma default Size=Large, the tools mark only Size=Large, State=Default', async () => {
    const set = buttonSet({size: 'Large'});

    assert.deepEqual(defaultMarks((await list(set)).text), ['Size=Large, State=Default']);
    const {text} = await analyze(set);
    assert.match(text, /^Variant: Size=Large, State=Default \(default\)$/m);
    assert.doesNotMatch(text, /Size=Small, State=Default \(default\)/);
});

test('A13: a two-variant set whose first child is Small and whose Figma default is Large marks Large', async () => {
    const variant = (id: string, size: string) => ({id, name: `Size=${size}`, type: 'COMPONENT', absoluteBoundingBox: {x: 0, y: 0, width: 80, height: 40}, children: []});
    const set = {
        id: '9:1', name: 'Chip', type: 'COMPONENT_SET', absoluteBoundingBox: {x: 0, y: 0, width: 200, height: 40},
        componentPropertyDefinitions: {Size: {type: 'VARIANT', defaultValue: 'Large', variantOptions: ['Small', 'Large']}},
        children: [variant('9:2', 'Small'), variant('9:3', 'Large')],
    };
    const {text} = await callToolOffline(nodeRoute(set.id, set), 'list_component_variants', {input: FILE_KEY, nodeId: set.id});

    assert.deepEqual(defaultMarks(text), ['Size=Large']);
});

test('D5: a four-variant set is analysed whole with its axes, and nothing asks to choose', async () => {
    const set = buttonSet();
    const listed = (await list(set)).text;
    const analysed = await analyze(set);

    for (const text of [listed, analysed.text]) {
        assert.doesNotMatch(text, /please specify|more than 3|variantSelection/i);
        assert.match(text, /^- Size: Small, Large \(default: Small\)$/m);
        assert.match(text, /^- State: Default, Disabled \(default: Default\)$/m);
        for (const name of ['Size=Small, State=Default', 'Size=Small, State=Disabled', 'Size=Large, State=Default', 'Size=Large, State=Disabled']) {
            assert.ok(text.includes(name), `${name} missing`);
        }
    }
    assert.equal([...analysed.text.matchAll(/^Variant: /gm)].length, 4);
});

test('Figma defaults that match no variant mark nothing and say so', async () => {
    const set = buttonSet({size: 'Medium'});
    const listed = (await list(set)).text;
    const analysed = (await analyze(set)).text;

    for (const text of [listed, analysed]) {
        assert.deepEqual(defaultMarks(text), []);
        assert.match(text, /Figma's defaults match no variant/);
    }
});

test('"(N of M)" equals the variants analysed, and no variant is fetched again', async () => {
    const set = buttonSet();
    const all = await analyze(set);
    assert.match(all.text, /Analyzed variants \(4 of 4\)/);
    assert.equal([...all.text.matchAll(/^Variant: /gm)].length, 4);
    assert.equal(all.requests.length, 1, 'the set response already holds every variant');

    const some = await analyze(set, {variantSelection: ['Size=Large, State=Disabled']});
    assert.match(some.text, /Analyzed variants \(2 of 4\)/);
    assert.equal([...some.text.matchAll(/^Variant: /gm)].length, 2);
    assert.equal(some.requests.length, 1);
});

const optionSet = (axis: string, options: string[], defaultValue: string) => ({
    id: '9:1', name: 'Chip', type: 'COMPONENT_SET', absoluteBoundingBox: {x: 0, y: 0, width: 200, height: 40},
    componentPropertyDefinitions: {[axis]: {type: 'VARIANT', defaultValue, variantOptions: options}},
    children: options.map((option, i) => ({
        id: `9:${i + 2}`, name: `${axis}=${option}`, type: 'COMPONENT', absoluteBoundingBox: {x: 0, y: 0, width: 80, height: 40}, children: [],
    })),
});

test('variant options that contain "=" or "," still match their Figma default', async () => {
    for (const [options, defaultValue] of [[['a=b', 'c'], 'a=b'], [['a,b', 'c'], 'a,b']] as const) {
        const set = optionSet('Size', [...options], defaultValue);
        const {text} = await callToolOffline(nodeRoute(set.id, set), 'list_component_variants', {input: FILE_KEY, nodeId: set.id});

        assert.deepEqual(defaultMarks(text), [`Size=${defaultValue}`], options.join('|'));
    }
});

test('a variantSelection that matches no variant says so, instead of returning the default', async () => {
    const set = buttonSet();
    const {text} = await analyze(set, {variantSelection: ['zzz']});

    assert.match(text, /^No variant matches the selection/);
    assert.doesNotMatch(text, /^Variant: /m);
});

test('the layout map is printed once per response, not once per variant', async () => {
    const set = buttonSet();
    const {text} = await callToolOffline(nodeRoute(set.id, set), 'analyze_figma_component', {
        input: `https://www.figma.com/design/${FILE_KEY}/x?node-id=1-86`, exportAssets: false,
    });

    assert.equal([...text.matchAll(/^Variant: /gm)].length, 4);
    assert.equal([...text.matchAll(/Layout map for AI Implementation/g)].length, 1);
});
