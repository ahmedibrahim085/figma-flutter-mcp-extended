// What a client sees in tools/list is the consumer contract: names, descriptions and input schemas. test/contract/tools-list.json is that
// list as the server sent it on 2026-10-04 (commit 73ca458). A change to any tool's schema or description changes this file in the
// same commit, and decision 38 asks for a consumer notice with it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withServer} from './helpers/mcp-stdio.ts';

test('tools/list is the committed list, byte for byte as JSON', async () => {
    let tools: unknown;
    await withServer(async (server) => {
        await server.initialize();
        tools = ((await server.request('tools/list')).result as any).tools;
    });

    assert.deepEqual(tools, JSON.parse(readFileSync(new URL('./contract/tools-list.json', import.meta.url), 'utf-8')));
});
