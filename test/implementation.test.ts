import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, callToolsOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

// generate_flutter_implementation renders the node it is given (ticket 12). Expected values are written here, not read from the code.
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
const frame = (id: string, name: string, extra: object = {}) =>
    ({id, name, type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: box(200, 100), fills: [], ...extra});

test('takes a file key and node id, like analyze_figma_component', async () => {
    const node = frame('70:1', 'Price Card');
    const result = await callToolOffline(nodeRoute(node.id, node), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: node.id});

    assert.equal(result.isError, false);
    assert.doesNotMatch(result.text, /validation/i);
});

const solid = (r: number, g: number, b: number) => ({type: 'SOLID', color: {r, g, b, a: 1}});
const text = (id: string, characters: string) => ({
    id, name: 'Label', type: 'TEXT', characters, absoluteBoundingBox: box(80, 20), fills: [solid(0, 0, 0)],
    style: {fontFamily: 'Inter', fontSize: 14, fontWeight: 400, letterSpacing: 0, lineHeightPx: 20, lineHeightUnit: 'PIXELS'},
});
const priceCard = frame('20:1', 'Price Card', {fills: [solid(1, 0, 0)], children: [text('20:2', 'Twelve euros')]});
const greetingBanner = frame('30:1', 'Greeting Banner', {fills: [solid(0, 0, 1)], children: [text('30:2', 'Hello there')]});

test('two node ids give two widgets, each with its own text, name and fill', async () => {
    const routes = {...nodeRoute(priceCard.id, priceCard), ...nodeRoute(greetingBanner.id, greetingBanner)};
    const [price, greeting] = await Promise.all([priceCard, greetingBanner].map(node =>
        callToolOffline(routes, 'generate_flutter_implementation', {input: FILE_KEY, nodeId: node.id})));

    assert.equal(price.isError, false);
    assert.match(price.text, /class PriceCard extends StatelessWidget/);
    assert.match(price.text, /Text\(\s*'Twelve euros'/);
    assert.match(price.text, /Color\(0xFFFF0000\)/);
    assert.doesNotMatch(price.text, /Hello there|Greeting|0xFF0000FF/);
    assert.match(greeting.text, /class GreetingBanner extends StatelessWidget/);
    assert.match(greeting.text, /Text\(\s*'Hello there'/);
    assert.match(greeting.text, /Color\(0xFF0000FF\)/);
    assert.doesNotMatch(greeting.text, /Twelve euros|Price|0xFFFF0000/);
});

test('the node is fetched by its own id, and styles cached by another node never reach the widget', async () => {
    const routes = {...nodeRoute(priceCard.id, priceCard), ...nodeRoute(greetingBanner.id, greetingBanner)};
    const [, greeting] = await callToolsOffline(routes, [
        ['analyze_figma_component', {input: FILE_KEY, nodeId: priceCard.id, exportAssets: false, userDefinedComponent: true}],
        ['generate_flutter_implementation', {input: FILE_KEY, nodeId: greetingBanner.id}],
    ]);

    assert.deepEqual(greeting.requests.map(request => [request.path, request.query.ids]), [[`/files/${FILE_KEY}/nodes`, '30:1']]);
    assert.match(greeting.text, /Color\(0xFF0000FF\)/);
    assert.doesNotMatch(greeting.text, /0xFFFF0000|Twelve euros/);
});

test('no template text or class name', async () => {
    const result = await callToolOffline(nodeRoute(priceCard.id, priceCard), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: priceCard.id});

    assert.doesNotMatch(result.text, /Sample Text|Widget Placeholder|Component Content|CustomWidget|TODO/);
});

const generate = (node: {id: string}, extra: object = {}) =>
    callToolOffline(nodeRoute(node.id, node), 'generate_flutter_implementation', {input: FILE_KEY, nodeId: node.id, ...extra});

test('the class is named from the layer name in UpperCamelCase, or from widgetName', async () => {
    const node = frame('21:1', 'Button / Primary', {children: [text('21:2', 'Go')]});

    assert.match((await generate(node)).text, /class ButtonPrimary extends StatelessWidget/);
    assert.match((await generate(node, {widgetName: 'PromoButton'})).text, /class PromoButton extends StatelessWidget/);
});

test('a layer name that is not a valid Dart type name gets no class, and the report says why', async () => {
    const node = frame('22:1', '404 Card', {children: [text('22:2', 'Not found')]});
    const result = await generate(node);

    assert.equal(result.isError, false);
    assert.doesNotMatch(result.text, /class \w+ extends StatelessWidget/);
    assert.match(result.text, /"404Card" is not a valid Dart type name/);
    assert.match(result.text, /Pass widgetName to generate_flutter_implementation to name the class\./);
});

test('a widgetName that is not a valid Dart type name gets no class', async () => {
    const result = await generate(frame('22:3', 'Price Card'), {widgetName: 'Function'});

    assert.doesNotMatch(result.text, /class \w+ extends StatelessWidget/);
    assert.match(result.text, /"Function" is not a valid Dart type name/);
    assert.match(result.text, /Pass widgetName to generate_flutter_implementation to name the class\./);
});

test('a class named like a widget its own body uses gets no class, and the report says why', async () => {
    const node = frame('23:1', 'Text', {children: [text('23:2', 'Hello')]});
    const result = await generate(node);

    assert.doesNotMatch(result.text, /class \w+ extends StatelessWidget/);
    assert.match(result.text, /"Text" is also a widget the generated body uses/);
    assert.match(result.text, /Pass widgetName to generate_flutter_implementation to name the class\./);
});

test('a component set gives one class per variant, named from the set name and the variant name', async () => {
    const variant = (id: string, name: string, label: string) => ({
        id, name, type: 'COMPONENT', layoutMode: 'VERTICAL', absoluteBoundingBox: box(100, 40), fills: [], children: [text(`${id}0`, label)],
    });
    const set = frame('24:1', 'Button', {type: 'COMPONENT_SET', children: [
        variant('24:2', 'Size=Small, State=Default', 'Continue'),
        variant('24:3', 'Size=Large, State=Disabled', 'Cancel'),
    ]});
    const result = await generate(set);

    assert.match(result.text, /class ButtonSizeSmallStateDefault extends StatelessWidget/);
    assert.match(result.text, /class ButtonSizeLargeStateDisabled extends StatelessWidget/);
    assert.match(result.text, /'Continue'/);
    assert.match(result.text, /'Cancel'/);
    assert.equal(result.text.match(/^class /gm)?.length, 2);
});

test('a variant gets the same class name passed directly as through its component set', async () => {
    const variant = {
        id: '25:2', name: 'Size=Small, State=Default', type: 'COMPONENT', layoutMode: 'VERTICAL', absoluteBoundingBox: box(100, 40), fills: [],
        children: [text('25:20', 'Continue')],
    };
    const set = frame('25:1', 'Button', {type: 'COMPONENT_SET', children: [variant]});
    // Figma's node response names a variant's set in its `components` and `componentSets` maps.
    const directRoutes = {[`/files/${FILE_KEY}/nodes?ids=${variant.id}`]: {body: {nodes: {[variant.id]: {
        document: variant,
        components: {[variant.id]: {name: variant.name, componentSetId: set.id}},
        componentSets: {[set.id]: {name: 'Button'}},
    }}}}};

    const direct = await callToolOffline(directRoutes, 'generate_flutter_implementation', {input: FILE_KEY, nodeId: variant.id});
    const viaSet = await generate(set);

    assert.match(direct.text, /class ButtonSizeSmallStateDefault extends StatelessWidget/);
    assert.match(viaSet.text, /class ButtonSizeSmallStateDefault extends StatelessWidget/);
});

test('a class named like a widget its style definitions use gets no class, and the report says why', async () => {
    const node = frame('26:1', 'BoxDecoration', {fills: [solid(1, 0, 0)], children: [text('26:2', 'Hello')]});
    const result = await generate(node);

    assert.doesNotMatch(result.text, /class \w+ extends StatelessWidget/);
    assert.match(result.text, /"BoxDecoration" is also a widget the generated body uses/);
});

test('a widgetName with a $ is still a valid class name', async () => {
    const result = await generate(frame('27:1', 'Price Card'), {widgetName: 'Card$Two'});

    assert.equal(result.isError, false);
    assert.match(result.text, /class Card\$Two extends StatelessWidget/);
});
