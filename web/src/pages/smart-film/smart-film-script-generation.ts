import { parseGeneratedSmartFilmScripts, smartFilmScriptPrompt, type GeneratedSmartFilmScript, type SmartFilmScriptReference } from "@/lib/canvas/smart-film-scripts";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { buildBackendGenerationTaskQuoteInput, runBackendGenerationTask } from "@/services/api/generation-task";
import type { SmartFilmSkillSnapshot } from "@/services/api/smart-film-batches";
import { quoteGenerationTask, type GenerationBillingQuote } from "@/services/api/task-billing";
import { smartFilmSkillMetadata, smartFilmSkillStagePrompt } from "@/services/smart-film-skill";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type SmartFilmScriptGenerationInput = {
    idea: string;
    references: SmartFilmScriptReference[];
    referenceImages?: ReferenceImage[];
    count: number;
    shotCount?: number;
    shotDurationSeconds?: number;
    config: AiConfig;
    batchId?: string;
    existingTitles?: string[];
    regenerateIndex?: number;
    skillSnapshot?: SmartFilmSkillSnapshot;
    onProgress?: (progress: number, stage?: string) => void;
};

function scriptGenerationPlan(input: SmartFilmScriptGenerationInput) {
    const count = input.regenerateIndex ? 1 : input.count;
    const maxImages = modelCapabilityConfigFor(input.config, input.config.model).text?.references?.maxImages;
    const referenceImages = Number.isFinite(maxImages) && Number(maxImages) > 0 ? (input.referenceImages || []).slice(0, Math.max(0, Math.trunc(Number(maxImages)))) : input.referenceImages || [];
    const references = input.references.map((reference) => ({
        ...reference,
        imageIndex: reference.imageIndex && reference.imageIndex <= referenceImages.length ? reference.imageIndex : undefined,
    }));
    const prompt = smartFilmSkillStagePrompt(input.skillSnapshot, "script", smartFilmScriptPrompt({ ...input, references, count }));
    const metadata = {
        source: "smart-film-batch-script",
        batchId: input.batchId || "",
        scriptCount: count,
        regenerateIndex: input.regenerateIndex || 0,
        ...smartFilmSkillMetadata(input.skillSnapshot),
    };
    return { count, prompt, referenceImages, metadata };
}

export function quoteSmartFilmScripts(input: SmartFilmScriptGenerationInput): Promise<GenerationBillingQuote> {
    const plan = scriptGenerationPlan(input);
    return quoteGenerationTask(
        buildBackendGenerationTaskQuoteInput({
            mode: "text",
            prompt: plan.prompt,
            config: input.config,
            referenceImages: plan.referenceImages,
            metadata: plan.metadata,
        }),
    );
}

export async function generateSmartFilmScripts(input: SmartFilmScriptGenerationInput): Promise<{ scripts: GeneratedSmartFilmScript[]; taskId: string }> {
    const plan = scriptGenerationPlan(input);
    const { count } = plan;
    let taskId = "";
    const result = await runBackendGenerationTask({
        mode: "text",
        prompt: plan.prompt,
        config: input.config,
        referenceImages: plan.referenceImages,
        metadata: plan.metadata,
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
