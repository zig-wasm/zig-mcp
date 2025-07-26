import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import envPaths from "env-paths";
import extractBuiltinFunctions, { type BuiltinFunction } from "./extract-builtin-functions.js";

export type UpdatePolicy = "manual" | "daily" | "startup";

export async function ensureDocs(
    zigVersion: string,
    updatePolicy: UpdatePolicy = "manual",
    isMcpMode = true,
): Promise<BuiltinFunction[]> {
    const paths = envPaths("zig-mcp", { suffix: "" });
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

            await downloadSourcesTar(zigVersion, isMcpMode, true);

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

export async function downloadSourcesTar(
    zigVersion: string,
    isMcpMode: boolean = false,
    forceUpdate: boolean = false,
): Promise<Uint8Array> {
    const paths = envPaths("zig-mcp", { suffix: "" });
    const versionCacheDir = path.join(paths.cache, zigVersion);
    const sourcesPath = path.join(versionCacheDir, "sources.tar");

    if (fs.existsSync(sourcesPath) && !forceUpdate) {
        if (!isMcpMode) console.log(`Using cached sources.tar from ${sourcesPath}`);
        return new Uint8Array(fs.readFileSync(sourcesPath));
    }

    const url = `https://ziglang.org/documentation/${zigVersion}/std/sources.tar`;
    if (!isMcpMode) console.log(`Downloading sources.tar from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Failed to download sources.tar from ${url}: ${response.status} ${response.statusText}`,
        );
    }

    const buffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    if (!fs.existsSync(versionCacheDir)) {
        fs.mkdirSync(versionCacheDir, { recursive: true });
    }

    fs.writeFileSync(sourcesPath, uint8Array);
    if (!isMcpMode) console.log(`Downloaded sources.tar to ${sourcesPath}`);

    return uint8Array;
}

async function downloadSourcesTarPath(zigVersion: string): Promise<string> {
    const paths = envPaths("zig-mcp", { suffix: "" });
    const versionCacheDir = path.join(paths.cache, zigVersion);
    const sourcesPath = path.join(versionCacheDir, "sources.tar");

    if (fs.existsSync(sourcesPath)) {
        console.log(`Using cached sources.tar from ${sourcesPath}`);
        return sourcesPath;
    }

    await downloadSourcesTar(zigVersion, false);
    return sourcesPath;
}

export async function startViewServer(zigVersion: string): Promise<void> {
    try {
        const sourcesPath = await downloadSourcesTarPath(zigVersion);

        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const wasmPath = path.join(currentDir, "main.wasm");
        const indexPath = path.join(currentDir, "index.html");
        const stdJsPath = path.join(currentDir, "std.js");

        const port = 8080;

        const server = http.createServer((req, res) => {
            let filePath: string;
            const url = req.url || "/";

            if (url === "/" || url === "/index.html") {
                filePath = indexPath;
            } else if (url === "/std.js") {
                filePath = stdJsPath;
            } else if (url === "/main.wasm") {
                filePath = wasmPath;
            } else if (url === "/sources.tar") {
                filePath = sourcesPath;
            } else {
                res.writeHead(404);
                res.end("File not found");
                return;
            }

            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end("File not found");
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const contentTypes: { [key: string]: string } = {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".wasm": "application/wasm",
                ".tar": "application/x-tar",
            };

            const contentType = contentTypes[ext] || "application/octet-stream";

            res.writeHead(200, { "Content-Type": contentType });
            fs.createReadStream(filePath).pipe(res);
        });

        server.listen(port, () => {
            const url = `http://localhost:${port}`;
            console.log(`Server started at ${url}`);
            console.log(`Serving Zig ${zigVersion} documentation`);
            console.log("Press Ctrl+C to stop the server");
        });

        process.on("SIGINT", () => {
            console.log("\nShutting down server...");
            server.close(() => {
                process.exit(0);
            });
        });
    } catch (error) {
        console.error("Error starting view server:", error);
        throw error;
    }
}
