export type SmartFilmRecoveryMode = "retry" | "regenerate";
export type SmartFilmRecoveryStage = "assets" | "storyboard";

export function smartFilmRecoveryStage(failedStep?: string): SmartFilmRecoveryStage | null {
    return failedStep === "assets" || failedStep === "storyboard" ? failedStep : null;
}

export function smartFilmRecoveryMessage(mode: SmartFilmRecoveryMode, reusedTask: boolean) {
    if (mode === "regenerate") return "已创建新的失败阶段任务，将重新调用模型";
    if (reusedTask) return "已复用已有任务结果，未重复提交或扣费";
    return "旧任务不可复用，已提交新的失败阶段任务";
}
