#!/usr/bin/env node
import {getServerConfig} from './config.js';
import {startMcpServer, startHttpServer} from './server.js';
import {Logger} from './utils/logger.js';

async function startServer(): Promise<void> {
    const config = getServerConfig();
    Logger.configureMode(config.isStdioMode);

    if (config.isStdioMode) {
        await startMcpServer(config.figmaApiKey!);
    } else if (config.isHttpMode) {
        if (config.isRemoteMode) {
            console.log('Starting Figma Flutter Server in REMOTE mode...');
            if (config.figmaApiKey) {
                console.log('✅ Server has fallback API key, but users can provide their own via:');
            } else {
                console.log('⚠️  Users MUST provide their own Figma API keys via:');
            }
            console.log('  - Authorization header (Bearer token)');
            console.log('  - X-Figma-Api-Key header');
            console.log('  - figmaApiKey query parameter');
            console.log('📝 Get API key: https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens');
        } else {
            console.log('Starting Figma Flutter Server in HTTP mode...');
        }
        await startHttpServer(config.httpPort, config.figmaApiKey);
    } else {
        console.log('Starting Figma Flutter Server...');
        console.log('⚠️  You must provide your Figma API key via:');
        console.log('   • CLI argument: --figma-api-key=YOUR_KEY');
        console.log('   • Environment: FIGMA_API_KEY=YOUR_KEY in .env file');
        console.log('');
        console.log('Available modes:');
        console.log('  --stdio   MCP client communication (requires API key)');
        console.log('  --http    Local testing via HTTP (requires API key)');
        console.log('  --remote  Remote deployment (users provide keys via HTTP headers)');
        console.log('');
        console.log('📝 Get your API key: https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens');
        console.log('Use --help for more options');
    }
}

startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});