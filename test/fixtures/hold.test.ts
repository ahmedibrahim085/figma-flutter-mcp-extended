// Run by test/test-run-cleanup.test.ts through tools/test-run.mjs: a suite that is still running when the signal arrives.
import {test} from 'node:test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

test('holds the run open', async () => {
    // Tells the caller the suite has started; the run folder is named in this variable (see test/helpers/mcp-stdio.ts).
    writeFileSync(join(process.env.FIGMA_FLUTTER_TEST_RUN_DIR!, 'started'), '');
    await new Promise((resolve) => setTimeout(resolve, 60000));
});
