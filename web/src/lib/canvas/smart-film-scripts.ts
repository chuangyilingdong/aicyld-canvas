export type GeneratedSmartFilmScript = {
    title: string;
    content: string;
};

export type SmartFilmScriptReference = {
    title: string;
    role: "product" | "scene" | "character" | "prop" | "other";
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
    references: SmartFilmScriptReference[];
    count: number;
    shotCount?: number;
    shotDurationSeconds?: number;
    existingTitles?: string[];
    regenerateIndex?: number;
}) {
    const referenceBlock = smartFilmReferenceBlock(input.references);
    const avoid = input.existingTitles?.length
        ? `不要重复以下已有剧本的标题和核心创意：${input.existingTitles.join("、")}。`
        : "";
    const target = input.regenerateIndex
        ? `只生成第 ${input.regenerateIndex} 条替代剧本，仍然输出 1 条。`
        : `生成 ${input.count} 条互不依赖、互不连续的独立短视频剧本。每条都会单独进入一个视频项目，不能写成前后集。`;
    const productionHint = input.shotCount && input.shotCount > 0
        ? `每条视频预计 ${input.shotCount} 个镜头${input.shotDurationSeconds && input.shotDurationSeconds > 0 ? `，单镜约 ${input.shotDurationSeconds} 秒` : ""}。`
        : "分镜数量和时长将在剧本确认后设置，本轮只需要写出完整、可拆分的独立剧本。";
    const directionRule = input.count >= 3
        ? "当生成 3 条及以上时，必须分别使用不同的创意策略：至少覆盖痛点共鸣、场景故事、结果证明中的三种方向；每条的开场钩子、主要场景、叙事结构和结尾不能重复。"
        : "不同剧本必须使用不同的开场钩子、主要场景、叙事结构和结尾。";
    return [
        "你是短视频导演和商业内容编剧。请把用户想法拆成可直接进入资产提取、分镜和视频生成的独立剧本。",
        "",
        `用户想法：${input.idea}`,
        referenceBlock,
        target,
        productionHint,
        "每条剧本都必须有完整开头钩子、核心对象或产品展示、卖点证明、情绪推进和明确结尾。",
        directionRule,
        "每条 content 必须以四行结构化字段开头：`创意方向：...`、`开场钩子：...`、`正文：...`、`结尾：...`；正文中写画面、动作、台词或旁白和产品卖点。",
        "不能只是替换同义词，也不能把同一条剧本改标题后重复输出。",
        avoid,
        "",
        "只返回严格 JSON，不要 Markdown，不要解释：",
        '{"scripts":[{"title":"不超过 24 字的标题","content":"创意方向：...\\n开场钩子：...\\n正文：...\\n结尾：..."}]}',
    ].filter(Boolean).join("\n");
}

function smartFilmReferenceBlock(references: SmartFilmScriptReference[]) {
    if (!references.length) {
        return "用户本次没有上传参考素材，请根据文字想法保持人物、场景、道具和产品描述具体、可执行。";
    }
    const labels: Record<SmartFilmScriptReference["role"], string> = {
        product: "产品参考",
        scene: "场景参考",
        character: "人物参考",
        prop: "道具参考",
        other: "其他参考",
    };
    const grouped = new Map<SmartFilmScriptReference["role"], Set<string>>();
    references.forEach((reference) => {
        const title = reference.title.trim();
        if (!title) return;
        const titles = grouped.get(reference.role) || new Set<string>();
        titles.add(title);
        grouped.set(reference.role, titles);
    });
    const lines = (Object.keys(labels) as SmartFilmScriptReference["role"][])
        .flatMap((role) => grouped.has(role) ? [`${labels[role]}：${Array.from(grouped.get(role)!).join("、")}`] : []);
    if (!lines.length) {
        return "用户本次没有上传参考素材，请根据文字想法保持人物、场景、道具和产品描述具体、可执行。";
    }
    return [
        "用户提供的参考素材如下，请按素材类型使用，不要把所有参考图都写成产品：",
        ...lines,
        "产品参考作为展示主体时必须保持外观一致；人物、场景和道具参考分别用于锁定角色身份、环境和关键物件，后续会用对应原图生成资产。",
        "凡是人物参考中提供了名称的，剧本必须原样使用该名称，不得改成“人物参考”“男主”“女主”等泛指称呼。",
    ].join("\n");
}
