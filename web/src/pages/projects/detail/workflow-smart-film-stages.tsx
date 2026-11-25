import { Button } from "antd";

import type { ProjectDetail, ProjectShot } from "@/services/api/projects";
import type { SmartFilmBatch } from "@/services/api/smart-film-batches";
import type { GenerationTask } from "@/services/api/task-center";

import { SmartFilmStoryboardBoard, SmartFilmVideoBoard } from "./smart-film-production-board";
import type { ShortDramaWorkflowStage } from "./workflow-shared";

type PromptSaveStatus = "draft" | "confirmed";

export function WorkflowSmartFilmStage({
    activeStage,
    detail,
    batch,
    shots,
    configurationPending,
    configurationError,
    readyStoryboardCount,
    promptPlan,
    videoModel,
    modelError,
    onVideoModelChange,
    promptOverride,
    onPromptOverrideChange,
    generatedPrompt,
    busy,
    submittingShotIds,
    targetSeconds,
    generating,
    generationError,
    generationTask,
    recoveryError,
    latestResourceId,
    staleWholeFilm,
    editPrompt,
    onBack,
    onNext,
    onRetryConfiguration,
    onSaveShotPrompt,
    onGenerateAll,
    onGenerateShot,
    onGenerateWholeFilm,
    onDownload,
}: {
    activeStage: ShortDramaWorkflowStage;
    detail: ProjectDetail;
    batch?: SmartFilmBatch;
    shots: ProjectShot[];
    configurationPending: boolean;
    configurationError?: string;
    readyStoryboardCount: number;
    promptPlan: ReturnType<typeof import("./use-smart-film-whole-film").useSmartFilmWholeFilm>["smartFilmPromptPlan"];
    videoModel: string;
    modelError: string;
    onVideoModelChange: (model: string) => void;
    promptOverride: string;
    onPromptOverrideChange: (prompt: string) => void;
    generatedPrompt: string;
    busy: boolean;
    submittingShotIds: Set<string>;
    targetSeconds: number;
    generating: boolean;
    generationError?: string;
    generationTask?: GenerationTask;
    recoveryError?: string;
    latestResourceId?: string;
    staleWholeFilm?: boolean;
    editPrompt?: string;
    onBack: () => void;
    onNext: () => void;
    onRetryConfiguration: () => void;
    onSaveShotPrompt: (shot: ProjectShot, imagePrompt: string, status?: PromptSaveStatus) => Promise<void>;
    onGenerateAll: () => void;
    onGenerateShot: (shot: ProjectShot, imagePrompt?: string) => void;
    onGenerateWholeFilm: () => void;
    onDownload: () => void;
}) {
    if (configurationPending) {
        return <SmartFilmStageLoading />;
    }
    if (configurationError) {
        return <SmartFilmStageError message={configurationError} onRetry={onRetryConfiguration} />;
    }
    if (activeStage === "previz") {
        return <SmartFilmNoPreviz onBack={onBack} />;
    }
    if (activeStage === "storyboard") {
        return <div className="h-full min-h-0">
            <SmartFilmStoryboardBoard
                detail={detail}
                batch={batch}
                shots={shots}
                readyCount={readyStoryboardCount}
                busy={busy}
                submittingShotIds={submittingShotIds}
                onSaveShotPrompt={(shot, imagePrompt) => onSaveShotPrompt(shot, imagePrompt)}
                onGenerateAll={onGenerateAll}
                onGenerateShot={onGenerateShot}
                onNext={onNext}
            />
        </div>;
    }
    if (activeStage === "video") {
        return <SmartFilmVideoBoard
            detail={detail}
            batch={batch}
            shots={shots}
            promptPlan={promptPlan}
            videoModel={videoModel}
            modelError={modelError}
            onVideoModelChange={onVideoModelChange}
            promptOverride={promptOverride}
            onPromptOverrideChange={onPromptOverrideChange}
            generatedPrompt={generatedPrompt}
            readyCount={readyStoryboardCount}
            targetSeconds={targetSeconds}
            generating={generating}
            generationError={generationError}
            generationTask={generationTask}
            recoveryError={recoveryError}
            latestResourceId={latestResourceId}
            staleWholeFilm={staleWholeFilm}
            editPrompt={editPrompt}
            onBack={onBack}
            onSaveShotPrompt={(shot, videoPrompt, status) => onSaveShotPrompt(shot, videoPrompt, status)}
            onGenerate={onGenerateWholeFilm}
            onDownload={onDownload}
        />;
    }
    return null;
}

function SmartFilmStageLoading() {
    return <div className="grid h-full place-items-center px-6 text-center">
        <div>
            <strong className="text-sm">正在读取成片配置</strong>
            <p className="mt-2 text-xs leading-5 text-foreground/45">正在确认本批次的分镜方式与制作规格，请稍候。</p>
        </div>
    </div>;
}

function SmartFilmNoPreviz({ onBack }: { onBack: () => void }) {
    return <div className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-md">
            <strong className="text-sm">智能整片不使用动作预演</strong>
            <p className="mt-2 text-xs leading-6 text-foreground/48">这个项目会根据镜头脚本和参考素材生成整片视频。请返回制作页面继续。</p>
            <Button className="mt-4" type="primary" onClick={onBack}>返回分镜图</Button>
        </div>
    </div>;
}

function SmartFilmStageError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return <div className="grid h-full place-items-center px-6 text-center" role="alert">
        <div className="max-w-md">
            <strong className="text-sm">成片配置读取失败</strong>
            <p className="mt-2 break-words text-xs leading-6 text-rose-500">{message}</p>
            <Button className="mt-4" onClick={onRetry}>重新读取</Button>
        </div>
    </div>;
}
