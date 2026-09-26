export class Logger {
    private static stdioMode = false;

    /** Call once at startup with the resolved --stdio flag. */
    static configureMode(isStdioMode: boolean): void {
        Logger.stdioMode = isStdioMode;
    }

    static log(...args: any[]): void {
        console.error('[MCP Server]', ...args);
    }

    static error(...args: any[]): void {
        console.error('[MCP Server ERROR]', ...args);
    }

    static warn(...args: any[]): void {
        console.error('[MCP Server WARN]', ...args);
    }

    static info(...args: any[]): void {
        console.error('[MCP Server INFO]', ...args);
    }

    /**
     * Status/progress output meant for a human watching the terminal.
     * In --stdio mode stdout is the JSON-RPC channel, so this routes to
     * stderr there; in HTTP/default mode it stays on stdout unchanged.
     */
    static diag(...args: any[]): void {
        if (Logger.stdioMode) {
            console.error(...args);
        } else {
            console.log(...args);
        }
    }
}
