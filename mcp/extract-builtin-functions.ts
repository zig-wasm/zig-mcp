import * as fs from "node:fs";
import * as path from "node:path";
import * as cheerio from "cheerio";
import envPaths from "env-paths";

export interface BuiltinFunction {
    func: string;
    signature: string;
    docs: string;
}

async function extractBuiltinFunctions(
    zigVersion: string,
    isMcpMode = true,
): Promise<BuiltinFunction[]> {
    const paths = envPaths("zig-mcp", { suffix: "" });
    const versionCacheDir = path.join(paths.cache, zigVersion);
    const outputPath = path.join(versionCacheDir, "builtin-functions.json");

    if (fs.existsSync(outputPath)) {
        if (!isMcpMode) console.log(`Using cached builtin functions from ${outputPath}`);
        try {
            const content = fs.readFileSync(outputPath, "utf8");
            return JSON.parse(content);
        } catch (error) {
            console.error(`Error reading cached file, re-extracting:`, error);
        }
    }

    const url = `https://ziglang.org/documentation/${zigVersion}/`;
    if (!isMcpMode) console.log(`Downloading HTML from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Failed to download HTML from ${url}: ${response.status} ${response.statusText}`,
        );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const builtins: BuiltinFunction[] = [];

    $("h3[id]").each((_, h3Element) => {
        const h3 = $(h3Element);
        const func = h3.find("a").first().text();

        if (!func.startsWith("@")) {
            return;
        }

        const signature = h3.next("pre").text().trim();
        const descriptionParts: string[] = [];
        const seeAlsoLinks: string[] = [];

        let current = h3.next("pre").next();
        while (current.length && current.prop("tagName")?.toLowerCase() !== "h3") {
            if (current.is("p")) {
                const pHtml = current.html() || "";
                const $p = cheerio.load(pHtml, {
                    xml: { xmlMode: false, decodeEntities: false },
                });

                $p("a").each((_, a) => {
                    const link = $p(a);
                    const href = link.attr("href") || "";
                    const text = link.text();
                    let markdownLink: string;
                    if (href.startsWith("#")) {
                        markdownLink = `[${text}](https://ziglang.org/documentation/${zigVersion}/${href})`;
                    } else {
                        markdownLink = `[${text}](${href})`;
                    }
                    link.replaceWith(markdownLink);
                });

                $p("code").each((_, code) => {
                    const el = $p(code);
                    el.replaceWith(`\`${el.text()}\``);
                });

                const pText = $p.root().text();
                descriptionParts.push(pText.replace(/\s+/g, " ").trim());
            } else if (current.is("ul")) {
                // Convert each <li> to Markdown, handling <a> and <code> tags
                current.children("li").each((_, li) => {
                    const liHtml = $(li).html() || "";
                    const $li = cheerio.load(liHtml, {
                        xml: { xmlMode: false, decodeEntities: false },
                    });

                    $li("a").each((_, a) => {
                        const link = $li(a);
                        const href = link.attr("href") || "";
                        const text = link.text();
                        let markdownLink: string;
                        if (href.startsWith("#")) {
                            markdownLink = `[${text}](https://ziglang.org/documentation/${zigVersion}/${href})`;
                        } else {
                            markdownLink = `[${text}](${href})`;
                        }
                        link.replaceWith(markdownLink);
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
            } else if (current.is("figure")) {
                // Extract <figcaption> and <pre> content
                const figcaption = current.find("figcaption").first().text().trim();
                const pre = current.find("pre").first();
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
                    // Format as Markdown code block
                    const codeBlock = `${label}\n\`\`\`${lang}\n${code.trim()}\n\`\`\``;
                    descriptionParts.push(codeBlock.trim());
                }
            }
            current = current.next();
        }

        // Join doc blocks with a single newline and collapse multiple newlines
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
    });

    if (!fs.existsSync(versionCacheDir)) {
        fs.mkdirSync(versionCacheDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(builtins, null, 2));

    if (!isMcpMode) console.log(`Extracted ${builtins.length} builtin functions to ${outputPath}`);

    return builtins;
}

export default extractBuiltinFunctions;
