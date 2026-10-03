import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {FigmaError, FigmaRateLimitError} from '../types/errors.js';

/** A Figma failure as the caller reads it: Figma's status and message, and for a 429 the wait and Figma's limit headers. */
function describeFailure(error: unknown): string {
    if (error instanceof FigmaRateLimitError) {
        const wait = error.retryAfter === undefined ? [] : [`Retry after ${error.retryAfter} seconds`];
        const details = [...wait, ...error.details].join(', ');
        return `Figma ${error.statusCode}: ${error.message}${details && ` (${details})`}`;
    }
    if (error instanceof FigmaError && error.statusCode) return `Figma ${error.statusCode}: ${error.message}`;
    return error instanceof Error ? error.message : String(error);
}

/**
 * Wraps a tool handler that calls Figma: whatever it throws becomes a tool result with
 * `isError: true`, so the client sees the call failed. `failure` is the tool's own prefix.
 */
export function figmaTool<Args extends unknown[]>(
    failure: string,
    handler: (...args: Args) => Promise<CallToolResult>,
): (...args: Args) => Promise<CallToolResult> {
    return async (...args) => {
        try {
            return await handler(...args);
        } catch (error) {
            return {content: [{type: 'text', text: `${failure}: ${describeFailure(error)}`}], isError: true};
        }
    };
}
