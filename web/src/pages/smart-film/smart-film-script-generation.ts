import { parseGeneratedSmartFilmScripts, smartFilmScriptPrompt, type GeneratedSmartFilmScript, type SmartFilmScriptReference } from "@/lib/canvas/smart-film-scripts";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";

export type SmartFilmScriptGenerationInput = {
    idea: string;
    references: SmartFilmScriptReference[];
    count: number;
    shotCount?: number;
    shotDurationSeconds?: number;
    config: AiConfig;
    batchId?: string;
    existingTitles?: string[];
    regenerateIndex?: number;
    onProgress?: (progress: number, stage?: string) => void;
};

export async function generateSmartFilmScripts(input: SmartFilmScriptGenerationInput): Promise<{ scripts: GeneratedSmartFilmScript[]; taskId: string }> {
    const count = input.regenerateIndex ? 1 : input.count;
    let taskId = "";
    const result = await runBackendGenerationTask({
        mode: "text",
        prompt: smartFilmScriptPrompt({ ...input, count }),
        config: input.config,
        metadata: {
            source: "smart-film-batch-script",
            batchId: input.batchId || "",
            scriptCount: count,
            regenerateIndex: input.regenerateIndex || 0,
        },
        onTaskUpdate: (task) => {
            taskId = task.id;
            const progress = typeof task.progress === "number" ? task.progress : 5;
            input.onProgress?.(Math.max(5, Math.min(95, Math.round(progress))), task.stage);
        },
    });
    const scripts = parseGeneratedSmartFilmScripts(result.text || "");
    if (scripts.length < count) {
        throw new Error(`模型只返回了 ${scripts.length} 条有效剧本，少于要求的 ${count} 条，请重试`);
    }
    return { scripts: scripts.slice(0, count), taskId };
}
