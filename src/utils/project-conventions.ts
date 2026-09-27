// src/utils/project-conventions.mts
import {readFile, readdir} from 'fs/promises';
import {join} from 'path';

/** Read the Dart package name from pubspec.yaml, needed to build `package:<name>/...` imports. */
export async function detectProjectName(projectPath: string): Promise<string> {
    try {
        const pubspecContent = await readFile(join(projectPath, 'pubspec.yaml'), 'utf-8');
        const nameMatch = pubspecContent.match(/^name:\s*(\S+)/m);
        if (nameMatch) {
            return nameMatch[1];
        }
    } catch {
        // pubspec.yaml missing - fall through to default
    }
    return 'flutter_app';
}

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
        'theme',
        join(projectPath, 'lib', 'constants'),
        'constants'
    );
}

/** Detect where the project already keeps golden tests (test/golden/ if present), else test/. */
export async function detectGoldenTestDir(projectPath: string): Promise<string> {
    const defaultDir = join(projectPath, 'test');
    return detectExistingSubdir(defaultDir, 'golden', defaultDir);
}
