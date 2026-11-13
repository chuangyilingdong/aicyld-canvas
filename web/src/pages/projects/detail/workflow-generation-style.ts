import { applyStyleExecutionPlan, parseStyleProfile, resolveStyleExecutionPlan } from "@/lib/canvas/style-profile";
import { resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export function projectStyleHint(styleProfileJson?: string) {
    const style = parseStyleProfile(styleProfileJson);
    return [style?.title, style?.prompt].filter(Boolean).join("：");
}

export function applyProjectStyleToGenerationPrompt(input: {
    prompt: string;
    styleProfileJson?: string;
    mode: "image" | "video";
    model: string;
    config: AiConfig;
}) {
    const styleProfile = parseStyleProfile(input.styleProfileJson);
    if (!styleProfile) return { prompt: input.prompt, plan: undefined };
    const channel = resolveModelChannel(input.config, input.model);
    const plan = resolveStyleExecutionPlan(styleProfile, {
        mode: input.mode,
        model: input.model,
        interfaceType: channel.interfaceType || input.config.apiFormat,
    });
    if (plan.status === "blocked") throw new Error(`项目画风未就绪：${plan.warnings.join("；") || "请到项目设置检查画风资产"}`);
    return { prompt: applyStyleExecutionPlan(input.prompt, plan), plan };
}
