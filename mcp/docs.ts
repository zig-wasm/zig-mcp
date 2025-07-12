import * as fs from "node:fs";
import * as path from "node:path";
import envPaths from "env-paths";
import extractBuiltinFunctions, { type BuiltinFunction } from "./extract-builtin-functions.js";

export type UpdatePolicy = "manual" | "daily" | "startup";

export async function ensureDocs(
    zigVersion: string,
    updatePolicy: UpdatePolicy = "manual",
    isMcpMode = true,
): Promise<BuiltinFunction[]> {
    const paths = envPaths("zig-docs-mcp", { suffix: "" });
    const metadataPath = path.join(paths.cache, zigVersion, "metadata.json");

    let shouldUpdate = false;

    if (updatePolicy === "startup") {
        shouldUpdate = true;
    } else if (updatePolicy === "daily") {
        if (!fs.existsSync(metadataPath)) {
            shouldUpdate = true;
        } else {
            try {
                const content = fs.readFileSync(metadataPath, "utf8");
                const metadata = JSON.parse(content);
                const dayInMs = 24 * 60 * 60 * 1000;
                shouldUpdate = Date.now() - metadata.lastUpdate >= dayInMs;
            } catch {
                shouldUpdate = true;
            }
        }
    }

    if (shouldUpdate) {
        try {
            if (!isMcpMode) console.log(`Updating documentation for Zig version: ${zigVersion}`);
            const builtinFunctions = await extractBuiltinFunctions(zigVersion, isMcpMode);

            const dir = path.dirname(metadataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(
                metadataPath,
                JSON.stringify(
                    {
                        lastUpdate: Date.now(),
                        version: zigVersion,
                    },
                    null,
                    2,
                ),
            );

            if (!isMcpMode)
                console.log(`Successfully updated documentation for Zig version: ${zigVersion}`);
            return builtinFunctions;
        } catch (error) {
            if (error instanceof Error && error.message.includes("404")) {
                console.error(
                    `Error: Zig version '${zigVersion}' not found on ziglang.org. Please check the version number.`,
                );
            } else {
                console.error(`Error updating documentation for version ${zigVersion}:`, error);
            }
            throw error;
        }
    }

    return await extractBuiltinFunctions(zigVersion, isMcpMode);
}
