// Preloaded into the server under test (`node --import`). Every DNS lookup for a
// host other than localhost fails with ENOTFOUND and is reported on stderr as
// `BLOCKED-NETWORK <host>`, so the suite can never reach the internet and can
// assert which host a tool tried to call. Local fakes bind 127.0.0.1 by IP,
// which needs no lookup.
import dns from 'node:dns';

const originalLookup = dns.lookup;

(dns as any).lookup = (hostname: string, options: unknown, callback?: unknown) => {
    if (hostname === 'localhost') {
        return (originalLookup as any)(hostname, options, callback);
    }
    const done = (typeof options === 'function' ? options : callback) as (error: Error) => void;
    process.stderr.write(`BLOCKED-NETWORK ${hostname}\n`);
    const error = Object.assign(new Error(`network access blocked in tests: ${hostname}`), {code: 'ENOTFOUND'});
    process.nextTick(() => done(error));
};
