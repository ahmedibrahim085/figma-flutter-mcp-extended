import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

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
