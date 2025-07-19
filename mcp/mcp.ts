import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureDocs, startViewServer, type UpdatePolicy } from "./docs.js";
import { registerAllTools } from "./tools.js";

interface CLIOptions {
    version: string;
    updatePolicy: UpdatePolicy;
    command?: "update" | "view";
}

function parseArgs(args: string[]): CLIOptions {
    const options: CLIOptions = {
        version: "master",
        updatePolicy: "manual",
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "update") {
            options.command = "update";
        } else if (arg === "view") {
            options.command = "view";
        } else if (arg === "--version" && i + 1 < args.length) {
            options.version = args[++i];
        } else if (arg === "--update-policy" && i + 1 < args.length) {
            const policy = args[++i];
            if (policy === "manual" || policy === "daily" || policy === "startup") {
                options.updatePolicy = policy;
            } else {
                console.error(
                    `Invalid update policy: ${policy}. Must be one of: manual, daily, startup`,
                );
                process.exit(1);
            }
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    return options;
}

function printHelp() {
    console.log(`Usage: zig-docs-mcp [options] [command]

Commands:
  update                                    Update documentation without starting MCP server
  view                                      Start local web server to view documentation

Options:
  --version <version>                       Zig version to use (default: master)
                                            Examples: master, 0.13.0, 0.14.1
  --update-policy <policy>                  Update policy (default: manual)
                                            Options: manual, daily, startup
  -h, --help                                Show this help message

Examples:
  zig-docs-mcp                              # Start MCP server with master version
  zig-docs-mcp --version 0.14.1             # Start with specific version
  zig-docs-mcp --update-policy daily        # Auto-update daily on startup
  zig-docs-mcp update --version 0.14.1      # Update docs to specific version
  zig-docs-mcp view --version master        # View documentation for specific version`);
}

async function main() {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    if (options.command === "update") {
        try {
            await ensureDocs(options.version, "startup", false);
            process.exit(0);
        } catch {
            process.exit(1);
        }
    }

    if (options.command === "view") {
        try {
            await startViewServer(options.version);
            return;
        } catch {
            process.exit(1);
        }
    }

    const builtinFunctions = await ensureDocs(options.version, options.updatePolicy, true);

    const mcpServer = new McpServer({
        name: "ZigDocs",
        description:
            "Retrieves up-to-date documentation for the Zig programming language standard library and builtin functions.",
        version: options.version,
    });

    registerAllTools(mcpServer, builtinFunctions);

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
}

main().catch((error) => {
    if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
    } else {
        console.error("An unexpected error occurred");
    }
    process.exit(1);
});
