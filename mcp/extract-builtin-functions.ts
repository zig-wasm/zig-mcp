import * as fs from "node:fs";
import * as path from "node:path";
import * as cheerio from "cheerio";
import envPaths from "env-paths";
import { getLocalLangRef } from "./local-std-server.js";

export interface BuiltinFunction {
    func: string;
    signature: string;
    docs: string;
}

function rewriteLink(text: string, href: string, linkBaseUrl: string | null): string {
    if (href.startsWith("#") && linkBaseUrl) {
        return `[${text}](${linkBaseUrl}${href})`;
    }

    return `[${text}](${href})`;
}

function parseBuiltinFunctionsHtml(html: string, linkBaseUrl: string | null): BuiltinFunction[] {
    const $ = cheerio.load(html);
    const builtins: BuiltinFunction[] = [];

    const builtinFunctionsSection = $('h2[id="Builtin-Functions"]');
    if (builtinFunctionsSection.length === 0) {
        throw new Error("Could not find Builtin Functions section in HTML");
    }

    let current = builtinFunctionsSection.next();
    while (current.length && current.prop("tagName")?.toLowerCase() !== "h2") {
        if (current.is("h3[id]")) {
            const h3 = current;
            const func = h3.find("a").first().text();

            if (func.startsWith("@")) {
                const signature = h3.next("pre").text().trim();
                const descriptionParts: string[] = [];
                const seeAlsoLinks: string[] = [];

                let descCurrent = h3.next("pre").next();
                while (
                    descCurrent.length &&
                    !["h2", "h3"].includes(descCurrent.prop("tagName")?.toLowerCase() || "")
                ) {
                    if (descCurrent.is("p")) {
                        const pHtml = descCurrent.html() || "";
                        const $p = cheerio.load(pHtml, {
                            xml: { xmlMode: false, decodeEntities: false },
                        });

                        $p("a").each((_, a) => {
                            const link = $p(a);
                            const href = link.attr("href") || "";
                            const text = link.text();
                            link.replaceWith(rewriteLink(text, href, linkBaseUrl));
                        });

                        $p("code").each((_, code) => {
                            const el = $p(code);
                            el.replaceWith(`\`${el.text()}\``);
                        });

                        const pText = $p.root().text();
                        descriptionParts.push(pText.replace(/\s+/g, " ").trim());
                    } else if (descCurrent.is("ul")) {
                        descCurrent.children("li").each((_, li) => {
                            const liHtml = $(li).html() || "";
                            const $li = cheerio.load(liHtml, {
                                xml: { xmlMode: false, decodeEntities: false },
                            });

                            $li("a").each((_, a) => {
                                const link = $li(a);
                                const href = link.attr("href") || "";
                                const text = link.text();
                                link.replaceWith(rewriteLink(text, href, linkBaseUrl));
                            });

                            $li("code").each((_, code) => {
                                const el = $li(code);
                                el.replaceWith(`\`${el.text()}\``);
                            });

                            const liText = $li.root().text().replace(/\s+/g, " ").trim();
                            if (liText.length > 0) {
                                descriptionParts.push(`* ${liText}`);
                            }
                        });
                    } else if (descCurrent.is("figure")) {
                        const figcaption = descCurrent.find("figcaption").first().text().trim();
                        const pre = descCurrent.find("pre").first();
                        const code = pre.text();
                        let lang = "";
                        let label = "";
                        if (figcaption) {
                            label = `**${figcaption}**\n`;
                            if (figcaption.endsWith(".zig")) {
                                lang = "zig";
                            } else if (figcaption.toLowerCase().includes("shell")) {
                                lang = "sh";
                            }
                        }
                        if (code) {
                            const codeBlock = `${label}\n\`\`\`${lang}\n${code.trim()}\n\`\`\``;
                            descriptionParts.push(codeBlock.trim());
                        }
                    }
                    descCurrent = descCurrent.next();
                }

                let docs = descriptionParts.join("\n");
                docs = docs.replace(/\n{2,}/g, "\n").replace(/\n+$/g, "");

                if (docs.toLowerCase().endsWith("see also:")) {
                    docs = docs.slice(0, -"see also:".length).trim();
                }

                if (seeAlsoLinks.length > 0) {
                    if (docs.length > 0) {
                        docs += "\n";
                    }
                    docs += `See also:\n* ${seeAlsoLinks.join("\n* ")}`;
                }

                builtins.push({
                    func,
                    signature,
                    docs,
                });
            }
        }
        current = current.next();
    }

    return builtins;
}

async function extractBuiltinFunctions(
    zigVersion: string,
    isMcpMode = true,
    forceUpdate = false,
    docSource: "local" | "remote" = "remote",
): Promise<BuiltinFunction[]> {
    let cacheVersion = zigVersion;
    let html: string | null = null;
    let linkBaseUrl: string | null = `https://ziglang.org/documentation/${zigVersion}/`;

    if (docSource === "local") {
        try {
            const localLangRef = getLocalLangRef();
            cacheVersion = localLangRef.version;
            html = localLangRef.html;
            linkBaseUrl = null;
            if (!isMcpMode) {
                console.log(`Using local Zig langref from ${localLangRef.path}`);
            }
        } catch (error) {
            if (!isMcpMode) {
                console.log(`Failed to use local Zig langref: ${error}`);
                console.log("Falling back to remote builtin documentation");
            }
        }
    }

    const paths = envPaths("zig-mcp", { suffix: "" });
    const versionCacheDir = path.join(paths.cache, cacheVersion);
    const outputPath = path.join(versionCacheDir, "builtin-functions.json");

    if (fs.existsSync(outputPath) && !forceUpdate) {
        if (!isMcpMode) console.log(`Using cached builtin functions from ${outputPath}`);
        try {
            const content = fs.readFileSync(outputPath, "utf8");
            return JSON.parse(content);
        } catch (error) {
            console.error(`Error reading cached file, re-extracting:`, error);
        }
    }

    if (!html) {
        const url = `https://ziglang.org/documentation/${zigVersion}/`;
        if (!isMcpMode) console.log(`Downloading HTML from: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(
                `Failed to download HTML from ${url}: ${response.status} ${response.statusText}`,
            );
        }

        html = await response.text();
    }

    const builtins = parseBuiltinFunctionsHtml(html, linkBaseUrl);

    if (!fs.existsSync(versionCacheDir)) {
        fs.mkdirSync(versionCacheDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(builtins, null, 2));

    if (!isMcpMode) console.log(`Extracted ${builtins.length} builtin functions to ${outputPath}`);

    return builtins;
}

export default extractBuiltinFunctions;
