// src/tools/flutter/testing/golden-test-tool.mts
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {figmaTool} from "../../figma-tool.js";
import {join} from "path";
import {mkdir, writeFile} from "fs/promises";
import {detectProjectName, detectGoldenTestDir, hasPubspec, missingPubspecMessage, resolveProjectPath, PROJECT_PATH_DESCRIPTION} from "../../../utils/project-conventions.js";
import defaults from '../../../defaults.json' with { type: 'json' };
import {label} from '../../../utils/labels.js';

function toSnakeCase(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
}

export function registerGoldenTestTools(server: McpServer, _figmaApiKey: string) {
    server.registerTool(
        "generate_golden_file_test",
        {
            title: "Generate Golden File Test",
            description:
                "Generate a golden file test for a Flutter widget (testWidgets + " +
                "matchesGoldenFile). Does not render, compare, or run anything itself — " +
                "run `flutter test --update-goldens` once to create the reference image, then " +
                "`flutter test` on later runs to check against it.",
            inputSchema: {
                widgetName: z.string().describe("Name of the Flutter widget class to test (e.g. ContinueButton)"),
                widgetImportPath: z.string().describe("Import path relative to lib/, e.g. 'widgets/continue_button.dart'"),
                projectPath: z.string().optional().describe(PROJECT_PATH_DESCRIPTION)
            }
        },
        figmaTool(label('goldenTest', 'error'), async ({widgetName, widgetImportPath, projectPath: givenPath}) => {
            const projectPath = resolveProjectPath(givenPath);
            if (!hasPubspec(projectPath)) {
                return {isError: true, content: [{type: "text", text: missingPubspecMessage(projectPath)}]};
            }
            // A missing pubspec.yaml is reported above, so only a pubspec without `name:` reaches this message.
            const projectName = await detectProjectName(projectPath);
            if (!projectName) {
                return {isError: true, content: [{type: "text", text: label('goldenTest', 'noProjectName', {projectPath})}]};
            }
            const testDir = await detectGoldenTestDir(projectPath);
            await mkdir(testDir, {recursive: true});

            const snakeCaseName = toSnakeCase(widgetName);
            const testFilePath = join(testDir, `${snakeCaseName}${defaults.output.goldenTestSuffix}`);
            const goldenFilePath = `${defaults.output.goldenImagesDir}/${snakeCaseName}.png`;

            const content = `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:${projectName}/${widgetImportPath}';

void main() {
  testWidgets('${widgetName} golden test', (tester) async {
await tester.pumpWidget(
  MaterialApp(
    home: Scaffold(
      body: ${widgetName}(),
    ),
  ),
);

await expectLater(
  find.byType(${widgetName}),
  matchesGoldenFile('${goldenFilePath}'),
);
  });
}
`;

            await writeFile(testFilePath, content);

            return {
                content: [{
                    type: "text",
                    text: label('goldenTest', 'written', {path: testFilePath, goldenPath: goldenFilePath})
                }]
            };
        })
    );
}
