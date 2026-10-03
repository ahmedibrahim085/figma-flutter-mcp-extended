// src/utils/project-conventions.mts
import {existsSync} from 'fs';
import {readFile, readdir} from 'fs/promises';
import {join} from 'path';
import defaults from '../defaults.json' with { type: 'json' };

/** The Dart package name in pubspec.yaml, needed to build `package:<name>/...` imports; undefined when the file or its `name:` is missing. */
export async function detectProjectName(projectPath: string): Promise<string | undefined> {
    try {
        const pubspecContent = await readFile(join(projectPath, 'pubspec.yaml'), 'utf-8');
        return pubspecContent.match(/^name:\s*(\S+)/m)?.[1];
    } catch {
        return undefined;
    }
}

/** Why a tool that edits a Flutter project stops: there is no pubspec.yaml to build on, and none is invented. */
export function missingPubspecMessage(projectPath: string): string {
    return `No pubspec.yaml in ${projectPath}. Run this in a Flutter project (flutter create), or pass projectPath. Nothing was requested or written.`;
}

/** The `projectPath` argument text of every tool that writes files; it matches resolveProjectPath. */
export const PROJECT_PATH_DESCRIPTION = 'Path to Flutter project (stdio: defaults to the current directory; HTTP: required)';

let overHttp = false;

/** Set once at startup, like Logger.configureMode: over HTTP the server's folder is not the client's project. */
export function configureProjectPath(isHttpMode: boolean): void {
    overHttp = isHttpMode;
}

/** The project a file-writing tool works in: the caller's `projectPath`, else the process folder over stdio, where client and server share it. */
export function resolveProjectPath(projectPath: string | undefined): string {
    if (projectPath !== undefined) return projectPath;
    if (overHttp) {
        throw new Error("projectPath is required over HTTP: the server's working folder is not the client's project. Pass the Flutter project's path on the machine that runs this server. Nothing was requested or written.");
    }
    return process.cwd();
}

export const hasPubspec = (projectPath: string): boolean => existsSync(join(projectPath, 'pubspec.yaml'));

/**
 * Detect an existing `subdirName` under `parentDir`, returning its path if
 * present (and, when given, `excludeIfPresent` is NOT also present as a
 * sibling), else `fallbackDir`.
 */
async function detectExistingSubdir(
    parentDir: string,
    subdirName: string,
    fallbackDir: string,
    excludeIfPresent?: string
): Promise<string> {
    try {
        const entries = await readdir(parentDir);
        if (entries.includes(subdirName) && (!excludeIfPresent || !entries.includes(excludeIfPresent))) {
            return join(parentDir, subdirName);
        }
    } catch {
        // parentDir doesn't exist yet - keep the fallback
    }
    return fallbackDir;
}

/**
 * Detect where the project already writes generated Dart constant files.
 * The theme/typography tools write to lib/theme/; if a project has already
 * used them (lib/theme/ exists) and has no separate lib/constants/, put
 * asset constants there too instead of creating a second, parallel folder.
 * Falls back to lib/constants/ (today's default) otherwise.
 */
export async function detectConstantsDir(projectPath: string): Promise<string> {
    return detectExistingSubdir(
        join(projectPath, 'lib'),
        defaults.output.themeSubdir,
        join(projectPath, 'lib', defaults.output.constantsSubdir),
        defaults.output.constantsSubdir
    );
}

/** Detect where the project already keeps golden tests (test/golden/ if present), else test/. */
export async function detectGoldenTestDir(projectPath: string): Promise<string> {
    const defaultDir = join(projectPath, 'test');
    return detectExistingSubdir(defaultDir, defaults.output.goldenTestSubdir, defaultDir);
}
