import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

interface LocalStdServer {
    process: child_process.ChildProcess;
    port: number;
    baseUrl: string;
}

interface LocalZigMetadata {
    zigPath: string;
    zigExePath: string;
    libDir: string | null;
    version: string;
}

interface LocalLangRef {
    version: string;
    path: string;
    html: string;
}

let activeServer: LocalStdServer | null = null;

function runZigCommand(zigPath: string, args: string[]): string {
    const result = child_process.spawnSync(zigPath, args, {
        encoding: "utf8",
    });

    if (result.status === 0) {
        return result.stdout.trim();
    }

    if (result.error) {
        throw result.error;
    }

    const stderr = result.stderr.trim();
    throw new Error(
        stderr.length > 0
            ? stderr
            : `zig ${args.join(" ")} exited with code ${result.status ?? "unknown"}`,
    );
}

function findZigExecutable(): string {
    const zigPath = process.env.ZIG_PATH || "zig";
    try {
        const result = runZigCommand(zigPath, ["version"]);
        if (result.includes("dev") || /\d+\.\d+\.\d+/.test(result)) {
            return zigPath;
        }
    } catch {
        // Continue to fallback
    }

    const commonPaths = [
        "/usr/local/bin/zig",
        "/usr/bin/zig",
        "/opt/homebrew/bin/zig",
        "/opt/zig/zig",
        path.join(process.env.HOME || "", ".local/bin/zig"),
    ];

    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            try {
                runZigCommand(p, ["version"]);
                return p;
            } catch {
                // Continue checking
            }
        }
    }

    return "zig";
}

function getZigEnvValue(output: string, key: string): string | null {
    const jsonMatch = output.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (jsonMatch) {
        return jsonMatch[1];
    }

    const zigSyntaxMatch = output.match(new RegExp(`\\.${key}\\s*=\\s*"([^"]+)"`));
    if (zigSyntaxMatch) {
        return zigSyntaxMatch[1];
    }

    return null;
}

function getLocalZigMetadata(): LocalZigMetadata {
    const zigPath = findZigExecutable();
    try {
        const envOutput = runZigCommand(zigPath, ["env"]);
        const zigExePath = getZigEnvValue(envOutput, "zig_exe") || zigPath;
        const version = getZigEnvValue(envOutput, "version") || runZigCommand(zigPath, ["version"]);
        const libDir = getZigEnvValue(envOutput, "lib_dir");

        return {
            zigPath,
            zigExePath,
            libDir,
            version,
        };
    } catch (error) {
        throw new Error(`Failed to inspect local Zig installation: ${error}`);
    }
}

export function getZigVersion(): string {
    return getLocalZigMetadata().version;
}

export function getLocalLangRef(): LocalLangRef {
    const metadata = getLocalZigMetadata();
    const candidates = [
        metadata.libDir ? path.resolve(metadata.libDir, "..", "doc", "langref.html") : null,
        path.resolve(path.dirname(metadata.zigExePath), "doc", "langref.html"),
        path.resolve(path.dirname(metadata.zigPath), "doc", "langref.html"),
    ].filter((candidate): candidate is string => candidate !== null);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return {
                version: metadata.version,
                path: candidate,
                html: fs.readFileSync(candidate, "utf8"),
            };
        }
    }

    throw new Error(`Failed to locate local langref.html. Checked: ${candidates.join(", ")}`);
}

export async function startLocalStdServer(): Promise<LocalStdServer> {
    if (activeServer) {
        return activeServer;
    }

    const zigPath = findZigExecutable();

    return new Promise((resolve, reject) => {
        const stdProcess = child_process.spawn(zigPath, ["std", "--no-open-browser"], {
            stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        let errorOutput = "";
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                stdProcess.kill();
                reject(new Error("Timeout waiting for Zig std server to start"));
            }
        }, 10000);

        stdProcess.stdout?.on("data", (data) => {
            output += data.toString();

            // Match patterns like "http://127.0.0.1:43695/"
            const match = output.match(/(http:\/\/[0-9.]+:[0-9]+)/);
            if (match && !resolved) {
                resolved = true;
                clearTimeout(timeout);

                const baseUrl = match[1];
                const port = parseInt(baseUrl.split(":").pop() || "43695");

                activeServer = {
                    process: stdProcess,
                    port,
                    baseUrl,
                };

                resolve(activeServer);
            }
        });

        stdProcess.stderr?.on("data", (data) => {
            errorOutput += data.toString();
        });

        stdProcess.on("error", (error) => {
            clearTimeout(timeout);
            if (!resolved) {
                resolved = true;
                reject(new Error(`Failed to start Zig std server: ${error.message}`));
            }
        });

        stdProcess.on("exit", (code) => {
            clearTimeout(timeout);
            if (!resolved) {
                resolved = true;
                reject(new Error(`Zig std server exited with code ${code}: ${errorOutput}`));
            }
            activeServer = null;
        });
    });
}

export function stopLocalStdServer(): void {
    if (activeServer) {
        activeServer.process.kill();
        activeServer = null;
    }
}

export async function fetchFromLocalServer(path: string): Promise<string> {
    const server = await startLocalStdServer();
    const url = `${server.baseUrl}${path}`;

    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                if (res.statusCode === 200) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        }).on("error", (error) => {
            reject(error);
        });
    });
}

export async function getLocalStdSources(): Promise<Uint8Array<ArrayBuffer>> {
    const server = await startLocalStdServer();
    const url = `${server.baseUrl}/sources.tar`;

    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            const chunks: Buffer[] = [];

            res.on("data", (chunk) => {
                chunks.push(chunk);
            });

            res.on("end", () => {
                if (res.statusCode === 200) {
                    const buffer = Buffer.concat(chunks);
                    resolve(new Uint8Array(buffer));
                } else {
                    reject(new Error(`Failed to fetch sources.tar: HTTP ${res.statusCode}`));
                }
            });
        }).on("error", (error) => {
            reject(error);
        });
    });
}

process.on("exit", stopLocalStdServer);
process.on("SIGINT", stopLocalStdServer);
process.on("SIGTERM", stopLocalStdServer);
