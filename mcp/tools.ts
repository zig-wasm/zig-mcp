import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import type { BuiltinFunction } from "./extract-builtin-functions.js";

function createListBuiltinFunctionsTool(builtinFunctions: BuiltinFunction[]) {
    return {
        name: "list_builtin_functions",
        config: {
            description:
                "Lists all available Zig builtin functions. Builtin functions are provided by the compiler and are prefixed with '@'. The comptime keyword on a parameter means that the parameter must be known at compile time. Use this to discover what functions are available, then use 'get_builtin_function' to get detailed documentation.",
        },
        handler: async () => {
            const functionList = builtinFunctions.map((fn) => `- ${fn.signature}`).join("\n");
            const message = `Available ${builtinFunctions.length} builtin functions:\n\n${functionList}`;

            return {
                content: [
                    {
                        type: "text" as const,
                        text: message,
                    },
                ],
            };
        },
    };
}

function getBuiltinFunctionTool(builtinFunctions: BuiltinFunction[]) {
    return {
        name: "get_builtin_function",
        config: {
            description:
                "Search for Zig builtin functions by name and get their documentation, signatures, and usage information. Returns all matching functions ranked by relevance.",
            inputSchema: {
                function_name: z
                    .string()
                    .min(1, "Query cannot be empty")
                    .describe(
                        "Function name or keywords (e.g., '@addWithOverflow', 'overflow', 'atomic')",
                    ),
            },
        },
        handler: async ({ function_name }: { function_name: string }) => {
            const queryLower = function_name.toLowerCase().trim();

            if (!queryLower) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: "Please provide a function name or keywords. Try searching for a function name like '@addWithOverflow' or keywords like 'overflow' or 'atomic'.",
                        },
                    ],
                };
            }

            const scoredFunctions = builtinFunctions
                .map((fn) => {
                    const funcLower = fn.func.toLowerCase();
                    let score = 0;

                    if (funcLower === queryLower) score += 1000;
                    else if (funcLower.startsWith(queryLower)) score += 500;
                    else if (funcLower.includes(queryLower)) score += 300;

                    if (score > 0) score += Math.max(0, 50 - fn.func.length);

                    return { ...fn, score };
                })
                .filter((fn) => fn.score > 0);

            scoredFunctions.sort((a, b) => b.score - a.score);

            if (scoredFunctions.length === 0) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `No builtin functions found matching "${function_name}". Try using 'list_builtin_functions' to see available functions, or refine your search terms.`,
                        },
                    ],
                };
            }

            const results = scoredFunctions
                .map((fn) => `**${fn.func}**\n\`\`\`zig\n${fn.signature}\n\`\`\`\n\n${fn.docs}`)
                .join("\n\n---\n\n");

            const message =
                scoredFunctions.length === 1
                    ? results
                    : `Found ${scoredFunctions.length} matching functions:\n\n${results}`;

            return {
                content: [
                    {
                        type: "text" as const,
                        text: message,
                    },
                ],
            };
        },
    };
}

export function registerAllTools(
    mcpServer: McpServer,
    builtinFunctions: BuiltinFunction[],
    _stdSources: Uint8Array<ArrayBuffer>,
) {
    const tools = [
        createListBuiltinFunctionsTool(builtinFunctions),
        getBuiltinFunctionTool(builtinFunctions),
    ];
    tools.forEach(({ name, config, handler }) => {
        mcpServer.registerTool(name, config, handler);
    });
}
