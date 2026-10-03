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
