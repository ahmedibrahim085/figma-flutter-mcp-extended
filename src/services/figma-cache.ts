// services/figma-cache.ts
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {homedir, platform} from 'node:os';
import {join} from 'node:path';
import defaults from '../defaults.json' with { type: 'json' };

/**
 * The cache folder, or undefined when the cache is off. `FIGMA_CACHE=off` turns it off and `FIGMA_CACHE_DIR`
 * replaces the default, the OS cache folder: ~/Library/Caches on macOS, %LOCALAPPDATA% on Windows, else
 * $XDG_CACHE_HOME or ~/.cache. Over HTTP the same rules apply on the server's disk.
 */
export function figmaCacheDir(): string | undefined {
    if (process.env.FIGMA_CACHE === 'off') return undefined;
    if (process.env.FIGMA_CACHE_DIR) return process.env.FIGMA_CACHE_DIR;
    const name = defaults.cache.dirName;
    if (platform() === 'darwin') return join(homedir(), 'Library', 'Caches', name);
    if (platform() === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), name, 'Cache');
    return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), name);
}

/** False when `FIGMA_SNAPSHOT=off`, else the default of `defaults.snapshot.enabled`: node reads are cut from one stored copy of the whole file. */
export const figmaSnapshotEnabled = (): boolean => process.env.FIGMA_SNAPSHOT === 'off' ? false : defaults.snapshot.enabled;

/** A file key that is safe to use as a folder name; anything else is read from Figma every time. */
export const isCacheableFileKey = (fileKey: string): boolean => /^[A-Za-z0-9_-]+$/.test(fileKey);

const digest = (parts: string[]): string => createHash('sha256').update(parts.join('\0')).digest('hex');

/** The entry name of one read: its path and its query, sorted so the parameter order does not matter. */
export function entryName(path: string, query: URLSearchParams | Record<string, string> = {}): string {
    const sorted = [...new URLSearchParams(query).entries()].sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
    return digest([path, JSON.stringify(sorted)]).slice(0, 32);
}

/**
 * The stored reads of one file at one marker (its `version` and `last_touched_at`), in
 * `<dir>/<fileKey>/<marker>/`. A new marker deletes the file's older folders, so the cache holds one
 * generation per file and needs no age or size limit.
 */
export class FileCache {
    /** The folder of this file at this marker; two caches of the same file and marker have the same one. */
    readonly folder: string;

    constructor(private dir: string, private fileKey: string, marker: string[]) {
        this.folder = join(dir, fileKey, digest(marker).slice(0, 32));
    }

    async read(name: string): Promise<Buffer | undefined> {
        try {
            return await readFile(join(this.folder, name));
        } catch {
            return undefined;
        }
    }

    /** `length` bytes of entry `name` from `offset`, or undefined when it is missing or shorter. */
    async readRange(name: string, offset: number, length: number): Promise<Buffer | undefined> {
        try {
            const handle = await open(join(this.folder, name), 'r');
            try {
                const bytes = Buffer.alloc(length);
                const {bytesRead} = await handle.read(bytes, 0, length, offset);
                return bytesRead === length ? bytes : undefined;
            } finally {
                await handle.close();
            }
        } catch {
            return undefined;
        }
    }

    // SHORTCUT: a failed write (full disk, read-only folder) only means the next call fetches again; it is not reported.
    // Upgrade path: log once per process on a failed write if cache misses need diagnosing.
    async write(name: string, data: Buffer | string): Promise<boolean> {
        try {
            await mkdir(this.folder, {recursive: true});
            const temp = join(this.folder, `${name}.${process.pid}.${randomUUID()}.tmp`); // unique per write: concurrent writes of one entry must not share it
            await writeFile(temp, data);
            await rename(temp, join(this.folder, name));
            const fileFolder = join(this.dir, this.fileKey);
            for (const other of await readdir(fileFolder)) {
                if (join(fileFolder, other) !== this.folder) await rm(join(fileFolder, other), {recursive: true, force: true});
            }
            return true;
        } catch {
            return false; // see SHORTCUT above
        }
    }
}
