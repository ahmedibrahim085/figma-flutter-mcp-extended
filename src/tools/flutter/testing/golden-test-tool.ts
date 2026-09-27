// src/tools/flutter/testing/golden-test-tool.mts
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {join} from "path";
import {mkdir, writeFile} from "fs/promises";
import {detectProjectName, detectGoldenTestDir} from "../../../utils/project-conventions.js";

function toSnakeCase(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
}

export function registerGoldenTestTools(server: McpServer, _figmaApiKey: string) {
    server.registerTool(
        "generate_golden_test_scaffold",
        {
            title: "Generate Golden Test Scaffold",
            description:
                "Generate a golden/snapshot test scaffold file for a Flutter widget (testWidgets + " +
                "matchesGoldenFile boilerplate). Does not render, compare, or run anything itself — " +
                "run `flutter test --update-goldens` once to create the reference image, then " +
                "`flutter test` on later runs to check against it.",
            inputSchema: {
                widgetName: z.string().describe("Name of the Flutter widget class to test (e.g. ContinueButton)"),
                widgetImportPath: z.string().describe("Import path relative to lib/, e.g. 'widgets/continue_button.dart'"),
                projectPath: z.string().optional().describe("Path to Flutter project (defaults to current directory)")
            }
        },
        async ({widgetName, widgetImportPath, projectPath = process.cwd()}) => {
            try {
                const projectName = await detectProjectName(projectPath);
                const testDir = await detectGoldenTestDir(projectPath);
                await mkdir(testDir, {recursive: true});

                const snakeCaseName = toSnakeCase(widgetName);
                const testFilePath = join(testDir, `${snakeCaseName}_golden_test.dart`);
                const goldenFilePath = `goldens/${snakeCaseName}.png`;

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
                        text:
                            `Golden test scaffold written to ${testFilePath}\n\n` +
                            `This only sets up the test structure — it does not render or compare anything.\n` +
                            `Run \`flutter test --update-goldens\` once to create the reference image at ` +
                            `${goldenFilePath}, then \`flutter test\` on later runs to check against it.`
                    }]
                };
            } catch (err: any) {
                return {content: [{type: "text", text: `Error generating golden test scaffold: ${err.message}`}]};
            }
        }
    );
}
