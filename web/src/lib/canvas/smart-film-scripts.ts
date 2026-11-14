export type GeneratedSmartFilmScript = {
    title: string;
    content: string;
};

export function parseGeneratedSmartFilmScripts(answer: string): GeneratedSmartFilmScript[] {
    const cleaned = answer.replace(/```json/gi, "").replace(/```/g, "").trim();
    const jsonScripts = parseJSONScripts(cleaned);
    if (jsonScripts.length) return jsonScripts;

    const lines = cleaned.split(/\r?\n/);
    const scripts: GeneratedSmartFilmScript[] = [];
    let title = "";
    let body: string[] = [];
    const flush = () => {
        const content = body.join("\n").trim();
        if (title.trim() && content) scripts.push({ title: title.trim().slice(0, 120), content });
        title = "";
        body = [];
    };
    for (const line of lines) {
        const heading = line.match(/^\s*(?:#{1,4}\s*)?(?:第?\s*\d+\s*[条集]?\s*[：:、.]\s*|剧本\s*\d+\s*[：:、.]\s*)(.+)$/i);
        if (heading && title) flush();
        if (heading) {
            title = heading[1].trim();
            continue;
        }
        if (/^\s*#{1,4}\s+/.test(line)) {
            if (title) flush();
            title = line.replace(/^\s*#{1,4}\s+/, "").trim();
            continue;
        }
        if (title) body.push(line);
    }
    flush();
    return scripts;
}

function parseJSONScripts(value: string): GeneratedSmartFilmScript[] {
    const candidates = [value];
    const objectStart = value.indexOf("{");
    const objectEnd = value.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) candidates.push(value.slice(objectStart, objectEnd + 1));
    const arrayStart = value.indexOf("[");
    const arrayEnd = value.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(value.slice(arrayStart, arrayEnd + 1));
    for (const candidate of candidates) {
        try {
            const parsed: unknown = JSON.parse(candidate);
            const rows = Array.isArray(parsed)
                ? parsed
                : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).scripts)
                  ? (parsed as Record<string, unknown>).scripts as unknown[]
                  : [];
            const scripts = rows.flatMap((row): GeneratedSmartFilmScript[] => {
                if (!row || typeof row !== "object") return [];
                const item = row as Record<string, unknown>;
                const title = String(item.title || item.name || "").trim();
                const content = String(item.content || item.script || item.text || "").trim();
                return title && content ? [{ title: title.slice(0, 120), content }] : [];
            });
            if (scripts.length) return scripts;
        } catch {
            // Try the next JSON slice, then fall back to Markdown headings.
        }
    }
    return [];
}

export function smartFilmScriptPrompt(input: {
    idea: string;
    productTitles: string[];
    count: number;
    shotCount: number;
    shotDurationSeconds: number;
    existingTitles?: string[];
    regenerateIndex?: number;
}) {
    const productBlock = input.productTitles.length
        ? `用户提供的产品参考图：${input.productTitles.join("、")}。剧本必须围绕这些产品，后续会用原图锁定产品外观。`
        : "用户本次没有上传产品参考图，请根据文字想法保持产品描述具体、可执行。";
    const avoid = input.existingTitles?.length
        ? `不要重复以下已有剧本的标题和核心创意：${input.existingTitles.join("、")}。`
        : "";
    const target = input.regenerateIndex
        ? `只生成第 ${input.regenerateIndex} 条替代剧本，仍然输出 1 条。`
        : `生成 ${input.count} 条互不依赖、互不连续的独立短视频剧本。每条都会单独进入一个视频项目，不能写成前后集。`;
    return [
        "你是短视频导演和商业内容编剧。请把用户想法拆成可直接进入资产提取、分镜和视频生成的独立剧本。",
        "",
        `用户想法：${input.idea}`,
        productBlock,
        target,
        `每条视频预计 ${input.shotCount} 个镜头，单镜约 ${input.shotDurationSeconds} 秒。`,
        "每条剧本都必须有完整开头钩子、产品展示、卖点证明、情绪推进和明确结尾。",
        "不同剧本必须使用不同创意角度，不能只是替换同义词。",
        avoid,
        "",
        "只返回严格 JSON，不要 Markdown，不要解释：",
        '{"scripts":[{"title":"不超过 24 字的标题","content":"完整剧本正文，包含画面、动作、台词或旁白、产品卖点和结尾"}]}',
    ].filter(Boolean).join("\n");
}
