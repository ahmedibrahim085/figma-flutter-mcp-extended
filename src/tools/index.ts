// src/tools/index.mts
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {registerFlutterTools} from "./flutter/index.js";
import {registerThemeTools} from "./flutter/theme/colors/theme-tool.js";
import {registerTypographyTools} from "./flutter/theme/typography/typography-tool.js";
import {registerCoreTools} from "./figma-core/core-tools.js";

export function registerAllTools(server: McpServer, figmaApiKey: string) {
    console.error('🛠️ Tools Debug - Starting tool registration...');

    // Core Figma tools (drop-in replacements for official MCP — no rate limit ceiling)
    registerCoreTools(server, figmaApiKey);
    console.error('🛠️ Tools Debug - Core Figma tools registered (ff_get_metadata, ff_get_screenshot, ff_get_design_context, ff_get_variable_defs)');

    // Flutter-specific tools
    registerFlutterTools(server, figmaApiKey);
    console.error('🛠️ Tools Debug - Flutter tools registered');

    registerThemeTools(server, figmaApiKey);
    console.error('🛠️ Tools Debug - Theme tools registered');

    registerTypographyTools(server, figmaApiKey);
    console.error('🛠️ Tools Debug - Typography tools registered');

    console.log("📋 Registered tool categories:");
    console.log("  🔑 Core tools - ff_get_metadata, ff_get_screenshot, ff_get_design_context, ff_get_variable_defs");
    console.log("  🚀 Flutter tools - Widgets, Screens");
    console.log("  🏞️ Export assets - Images, SVGs");
    console.log("  🎨 Theme tools - Colors, Typography");
    console.log("  📝 Typography tools - Fonts, Sizes");

    console.error('🛠️ Tools Debug - All tools registration complete');
}