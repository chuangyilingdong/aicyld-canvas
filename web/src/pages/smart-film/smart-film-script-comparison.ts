import type { SmartFilmScript } from "@/services/api/smart-film-batches";

export type SmartFilmScriptComparison = {
    direction: string;
    hook: string;
    body: string;
    ending: string;
    characters: number;
    structured: boolean;
};

export function compareSmartFilmScript(script: Pick<SmartFilmScript, "content">): SmartFilmScriptComparison {
    const content = script.content.trim();
    const direction = field(content, "创意方向");
    const hook = field(content, "开场钩子");
    const ending = field(content, "结尾");
    const body = content.match(/正文[：:]\s*([\s\S]*?)(?=\n结尾[：:]|$)/)?.[1]?.trim() || content;
    return {
        direction,
        hook,
        body: body || content,
        ending,
        characters: Array.from(content.replace(/\s/g, "")).length,
        structured: Boolean(direction || hook || ending || body !== content),
    };
}

export function canCompareSmartFilmScripts(scripts: unknown[]) {
    return scripts.length >= 2 && scripts.length <= 3;
}

function field(content: string, label: string) {
    const match = content.match(new RegExp(`${label}[：:]\\s*([^\\n]+)`));
    return match?.[1]?.trim() || "";
}
