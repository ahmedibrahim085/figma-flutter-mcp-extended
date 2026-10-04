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

// Figma documents the 403 of the Variables endpoints: "API is not available. Possible error messages are Limited by Figma plan,
// Incorrect account type, or Invalid scope. This could also indicate the developer / OAuth token is invalid or expired"
// (https://developers.figma.com/docs/rest-api/variables-endpoints/). Only the first is a plan requirement.
test('403 "Limited by Figma plan" on variables is Figma\'s message plus Figma\'s own sentence on who the API is for', async () => {
    const {text, isError, requests} = await variableDefs(PLAN_LIMITED);

    assert.equal(isError, true);
    assert.equal(text, 'ff_get_variable_defs error: Figma 403: Limited by Figma plan. This API is available to full members of Enterprise orgs.');
    assert.deepEqual(sent(requests), [{path: VARIABLES_PATH, query: {}}]);
});

for (const message of ['Invalid token', 'Invalid scope', 'Incorrect account type']) {
    test(`403 "${message}" on variables is Figma's own message and never a plan requirement`, async () => {
        const {text, isError} = await variableDefs({status: 403, body: {status: 403, err: message}});

        assert.equal(isError, true);
        assert.equal(text, `ff_get_variable_defs error: Figma 403: ${message}`);
    });
}

test('429 on variables is a tool error that shows the wait, plan tier and limit type', async () => {
    const {text, isError} = await variableDefs(rateLimited(354850));

    assert.equal(isError, true);
    assert.equal(text, 'ff_get_variable_defs error: Figma 429: Rate limit exceeded ' +
        '(Retry after 354850 seconds, x-figma-plan-tier: starter, x-figma-rate-limit-type: high)');
});

test('429 on variables without rate-limit headers shows only Figma\'s message', async () => {
    const {text, isError} = await variableDefs({status: 429, body: {status: 429, err: 'Rate limit exceeded'}});

    assert.equal(isError, true);
    assert.equal(text, 'ff_get_variable_defs error: Figma 429: Rate limit exceeded');
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
    assert.equal(text, 'Error analyzing component: Figma 429: Rate limit exceeded ' +
        '(Retry after 1 seconds, x-figma-plan-tier: starter, x-figma-rate-limit-type: high)');
    assert.deepEqual(sent(requests), Array(3).fill({path: NODES_PATH, query: {ids: '1:1'}}));
});

test('429 with a Retry-After beyond the retry budget fails at once instead of retrying early', async () => {
    const {text, isError, requests} = await analyzeComponent(rateLimited(354850));

    assert.equal(isError, true);
    assert.equal(text, 'Error analyzing component: Figma 429: Rate limit exceeded ' +
        '(Retry after 354850 seconds, x-figma-plan-tier: starter, x-figma-rate-limit-type: high)');
    assert.deepEqual(sent(requests), [{path: NODES_PATH, query: {ids: '1:1'}}]);
});

test('429 with Retry-After: 0 is retried at once: 0 seconds is "retry now", not "no header"', async () => {
    const {text, requests} = await analyzeComponent(rateLimited(0));

    assert.equal(text, 'Error analyzing component: Figma 429: Rate limit exceeded ' +
        '(Retry after 0 seconds, x-figma-plan-tier: starter, x-figma-rate-limit-type: high)');
    assert.equal(requests.length, 3);
    const gaps = requests.slice(1).map((request, i) => request.at - requests[i].at);
    assert.ok(gaps.every((gap) => gap < 500), `waits between attempts: ${gaps.join(', ')} ms`);
});

test('429 whose Retry-After is not a number keeps the default backoff', async () => {
    const {requests} = await analyzeComponent({...rateLimited(1), headers: {'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT'}});

    assert.equal(requests.length, 3);
    // The first default backoff is retry.initialDelayMs in src/defaults.json (1000 ms); 900 leaves room for timer jitter. Change one with the other.
    assert.ok(requests[1].at - requests[0].at >= 900, `wait before the second attempt: ${requests[1].at - requests[0].at} ms`);
});
