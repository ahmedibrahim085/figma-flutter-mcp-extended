import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callToolOffline, FILE_KEY} from './helpers/offline-tool.ts';
import type {FakeResponse} from './helpers/fake-figma.ts';

// Figma's error shapes: 403 for plan-gated endpoints (the Variables API is Enterprise-only),
// 429 with Retry-After in seconds plus the plan tier and rate-limit type headers.
const PLAN_LIMITED: FakeResponse = {status: 403, body: {status: 403, err: 'Limited by Figma plan'}};
const rateLimited = (retryAfterSeconds: number): FakeResponse => ({
    status: 429,
    headers: {'Retry-After': String(retryAfterSeconds), 'x-figma-plan-tier': 'starter', 'x-figma-rate-limit-type': 'low'},
    body: {status: 429, err: 'Rate limit exceeded'},
});

const variableDefs = (response: FakeResponse) => callToolOffline(
    {[`/files/${FILE_KEY}/variables/local`]: response}, 'ff_get_variable_defs', {fileKey: FILE_KEY, nodeId: '1:1'});

const analyzeComponent = (response: FakeResponse) => callToolOffline(
    {[`/files/${FILE_KEY}/nodes`]: response}, 'analyze_figma_component', {input: FILE_KEY, nodeId: '1:1'});

const paths = (requests: Array<{path: string}>) => requests.map((r) => r.path);

test('403 on variables is a tool error that names the Enterprise plan', async () => {
    const {text, isError, requests} = await variableDefs(PLAN_LIMITED);

    assert.equal(isError, true);
    assert.match(text, /The Variables REST API requires an Enterprise plan \(other plans get 403 "Limited by Figma plan"\)\./);
    assert.deepEqual(paths(requests), [`/files/${FILE_KEY}/variables/local`]);
});

test('429 on variables is a tool error after one request', async () => {
    const {text, isError, requests} = await variableDefs(rateLimited(1));

    assert.equal(isError, true);
    assert.match(text, /^Error 429: /);
    assert.deepEqual(paths(requests), [`/files/${FILE_KEY}/variables/local`]);
});

test('403 on a codegen tool is a tool error and is not retried', async () => {
    const {text, isError, requests} = await analyzeComponent(PLAN_LIMITED);

    assert.equal(isError, true);
    assert.match(text, /^Error analyzing component: .*Limited by Figma plan/);
    assert.deepEqual(paths(requests), [`/files/${FILE_KEY}/nodes`]);
});

test('429 with a short Retry-After on a codegen tool retries a bounded number of times', async () => {
    const {text, isError, requests} = await analyzeComponent(rateLimited(1));

    assert.equal(isError, true);
    assert.equal(text, 'Error analyzing component: Rate limit exceeded. Retry after 1 seconds');
    assert.deepEqual(paths(requests), Array(3).fill(`/files/${FILE_KEY}/nodes`));
});

test('429 with a Retry-After beyond the retry budget fails at once instead of retrying early', async () => {
    const {text, isError, requests} = await analyzeComponent(rateLimited(3600));

    assert.equal(isError, true);
    assert.equal(text, 'Error analyzing component: Rate limit exceeded. Retry after 3600 seconds');
    assert.deepEqual(paths(requests), [`/files/${FILE_KEY}/nodes`]);
});
