import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import type { BuiltinFunction } from "./extract-builtin-functions.js";
import { getStdLibItem, searchStdLib } from "./std.js";

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

function searchStdLibTool(wasmPath: string, stdSources: Uint8Array<ArrayBuffer>) {
    return {
        name: "search_std_lib",
        config: {
            description:
                "Search the Zig standard library for functions, types, namespaces, and other declarations. Returns detailed markdown documentation for each matching item. Use this to explore the standard library and discover available functionality. Supports fuzzy matching and returns results ranked by relevance.",
            inputSchema: {
                query: z
                    .string()
                    .min(1, "Search query cannot be empty")
                    .describe(
                        "Search terms to find in the standard library (e.g., 'ArrayList', 'print', 'allocator', 'HashMap')",
                    ),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .default(20)
                    .describe("Maximum number of results to return (default: 20)"),
            },
        },
        handler: async ({ query, limit = 20 }: { query: string; limit: number }) => {
            try {
                const markdown = await searchStdLib(wasmPath, stdSources, query, limit);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: markdown,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Error searching standard library: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        },
    };
}

function getStdLibItemTool(wasmPath: string, stdSources: Uint8Array<ArrayBuffer>) {
    return {
        name: "get_std_lib_item",
        config: {
            description:
                "Get detailed documentation for a specific item in the Zig standard library. Provide the fully qualified name (e.g., 'std.ArrayList', 'std.debug.print', 'std.mem.Allocator') to get comprehensive documentation including function signatures, parameters, return types, error sets, example usage, and optionally source code.",
            inputSchema: {
                name: z
                    .string()
                    .min(1, "Item name cannot be empty")
                    .describe(
                        "Fully qualified name of the standard library item (e.g., 'std.ArrayList', 'std.debug.print', 'std.mem.Allocator')",
                    ),
                get_source_file: z
                    .boolean()
                    .default(false)
                    .describe(
                        "Return the entire source file where this item is implemented (default: false - shows detailed documentation with item source code only)",
                    ),
            },
        },
        handler: async ({
            name,
            get_source_file = false,
        }: {
            name: string;
            get_source_file: boolean;
        }) => {
            try {
                const markdown = await getStdLibItem(wasmPath, stdSources, name, get_source_file);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: markdown,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Error getting standard library item: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        },
    };
}

export function registerAllTools(
    mcpServer: McpServer,
    builtinFunctions: BuiltinFunction[],
    stdSources: Uint8Array<ArrayBuffer>,
) {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.join(currentDir, "main.wasm");

    const listBuiltinFunctionsTool = createListBuiltinFunctionsTool(builtinFunctions);
    mcpServer.registerTool(
        listBuiltinFunctionsTool.name,
        listBuiltinFunctionsTool.config,
        listBuiltinFunctionsTool.handler,
    );

    const getBuiltinFunction = getBuiltinFunctionTool(builtinFunctions);
    mcpServer.registerTool(
        getBuiltinFunction.name,
        getBuiltinFunction.config,
        getBuiltinFunction.handler,
    );

    const stdLibSearch = searchStdLibTool(wasmPath, stdSources);
    mcpServer.registerTool(stdLibSearch.name, stdLibSearch.config, stdLibSearch.handler);

    const stdLibItem = getStdLibItemTool(wasmPath, stdSources);
    mcpServer.registerTool(stdLibItem.name, stdLibItem.config, stdLibItem.handler);
}
