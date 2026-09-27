import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, FILE_KEY} from './helpers/offline-tool.ts';
import type {FakeResponse, RecordedRequest} from './helpers/fake-figma.ts';

// Figma's error shapes: 403 for plan-gated endpoints (the Variables API is Enterprise-only),
// 429 with Retry-After in seconds plus the plan tier and rate-limit type headers. A real
// Starter-plan 429 carried Retry-After: 354850 (about 4 days) and x-figma-rate-limit-type: high.
const PLAN_LIMITED: FakeResponse = {status: 403, body: {status: 403, err: 'Limited by Figma plan'}};
const rateLimited = (retryAfterSeconds: number): FakeResponse => ({
    status: 429,
    headers: {'Retry-After': String(retryAfterSeconds), 'x-figma-plan-tier': 'starter', 'x-figma-rate-limit-type': 'high'},
    body: {status: 429, err: 'Rate limit exceeded'},
});

const VARIABLES_PATH = `/files/${FILE_KEY}/variables/local`;
const NODES_PATH = `/files/${FILE_KEY}/nodes`;

const variableDefs = (response: FakeResponse) =>
    callToolOffline({[VARIABLES_PATH]: response}, 'ff_get_variable_defs', {fileKey: FILE_KEY});

const analyzeComponent = (response: FakeResponse) =>
    callToolOffline({[`${NODES_PATH}?ids=1:1`]: response}, 'analyze_figma_component', {input: FILE_KEY, nodeId: '1:1'});

const sent = (requests: RecordedRequest[]) => requests.map((r) => ({path: r.path, query: r.query}));

test('403 on variables is a tool error that names the Enterprise plan', async () => {
    const {text, isError, requests} = await variableDefs(PLAN_LIMITED);

    assert.equal(isError, true);
    assert.match(text, /The Variables REST API requires an Enterprise plan \(other plans get 403 "Limited by Figma plan"\)\./);
    assert.deepEqual(sent(requests), [{path: VARIABLES_PATH, query: {}}]);
});

test('429 on variables is a tool error that shows the wait, plan tier and limit type', async () => {
    const {text, isError} = await variableDefs(rateLimited(354850));

    assert.equal(isError, true);
    assert.equal(text, 'Error 429: {"status":429,"err":"Rate limit exceeded"} ' +
        '(Retry after 354850 seconds, x-figma-plan-tier: starter, x-figma-rate-limit-type: high)');
});

test('429 on variables without rate-limit headers shows only the body', async () => {
    const {text, isError} = await variableDefs({status: 429, body: {status: 429, err: 'Rate limit exceeded'}});

    assert.equal(isError, true);
    assert.equal(text, 'Error 429: {"status":429,"err":"Rate limit exceeded"}');
});

test('an unreadable variables response is a tool error', async () => {
    const {text, isError} = await variableDefs({body: Buffer.from('not json')});

    assert.equal(isError, true);
    assert.match(text, /^ff_get_variable_defs error: /);
});

test('403 on a codegen tool is a tool error and is not retried', async () => {
    const {text, isError, requests} = await analyzeComponent(PLAN_LIMITED);

    assert.equal(isError, true);
    assert.match(text, /^Error analyzing component: .*Limited by Figma plan/);
    assert.deepEqual(sent(requests), [{path: NODES_PATH, query: {ids: '1:1'}}]);
});

test('429 with a short Retry-After on a codegen tool retries a bounded number of times', async () => {
    const {text, isError, requests} = await analyzeComponent(rateLimited(1));

    assert.equal(isError, true);
    assert.equal(text, 'Error analyzing component: Rate limit exceeded. Retry after 1 seconds');
    assert.deepEqual(sent(requests), Array(3).fill({path: NODES_PATH, query: {ids: '1:1'}}));
});

test('429 with a Retry-After beyond the retry budget fails at once instead of retrying early', async () => {
    const {text, isError, requests} = await analyzeComponent(rateLimited(354850));

    assert.equal(isError, true);
    assert.equal(text, 'Error analyzing component: Rate limit exceeded. Retry after 354850 seconds');
    assert.deepEqual(sent(requests), [{path: NODES_PATH, query: {ids: '1:1'}}]);
});
