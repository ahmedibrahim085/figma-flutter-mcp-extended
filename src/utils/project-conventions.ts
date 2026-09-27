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

/** Detect where the project already keeps golden tests (test/golden/ if present), else test/. */
export async function detectGoldenTestDir(projectPath: string): Promise<string> {
    const defaultDir = join(projectPath, 'test');
    try {
        const testEntries = await readdir(defaultDir);
        if (testEntries.includes('golden')) {
            return join(defaultDir, 'golden');
        }
    } catch {
        // test/ doesn't exist yet - keep the default
    }
    return defaultDir;
}
