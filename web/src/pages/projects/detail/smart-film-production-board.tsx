import { Button } from "antd";
import { ArrowLeft, ArrowRight, CheckCircle2, Clapperboard, Download, Film, Image as ImageIcon, LoaderCircle, Sparkles, Video } from "lucide-react";

import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";

import { ArtifactStatus, currentArtifact, currentRevision, formatDuration } from "./workflow-shared";

export function SmartFilmStoryboardBoard({ detail, shots, readyCount, pendingPromptCount, busy, submittingShotIds, onConfirmPrompts, onGenerateAll, onGenerateShot, onPreviewImage, onNext }: {
    detail: ProjectDetail;
    shots: ProjectShot[];
    readyCount: number;
    pendingPromptCount: number;
    busy: boolean;
    submittingShotIds: Set<string>;
    onConfirmPrompts: () => void;
    onGenerateAll: () => void;
    onGenerateShot: (shot: ProjectShot) => void;
    onPreviewImage: (artifact: ShotArtifact) => void;
    onNext: () => void;
}) {
    const allReady = shots.length > 0 && readyCount === shots.length;
    return (
        <section className="min-h-0 overflow-auto px-4 py-4 thin-scrollbar">
            <header className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-foreground/[.06] px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/55">步骤 1 / 2</span>
                        <strong className="text-sm">生成分镜图</strong>
                        <span className="text-xs text-foreground/42">分镜图已就绪 {readyCount}/{shots.length} 张</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground/48">先检查全部镜头的画面提示词和视频提示词，再批量生成静态分镜图。全部完成后进入整片视频步骤。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<CheckCircle2 className="size-4" />} disabled={busy || pendingPromptCount === 0} onClick={onConfirmPrompts}>确认全部提示词{pendingPromptCount ? `（${pendingPromptCount} 待确认）` : ""}</Button>
                    <Button icon={<Sparkles className="size-4" />} loading={busy} disabled={allReady || pendingPromptCount > 0} onClick={onGenerateAll}>{allReady ? "全部分镜图已生成" : "生成缺失分镜图"}</Button>
                    <Button type="primary" icon={<ArrowRight className="size-4" />} disabled={!allReady || busy || pendingPromptCount > 0} onClick={onNext}>下一步：整片视频</Button>
                </div>
            </header>

            <div className="grid gap-3">
                {shots.map((shot, index) => {
                    const revision = currentRevision(detail, shot);
                    const artifact = currentArtifact(detail, shot.id, "storyboard");
                    const ready = Boolean(artifact?.resourceId && artifact.status === "ready");
                    const submitting = submittingShotIds.has(shot.id);
                    const imagePrompt = revision?.imagePrompt || "未单独填写；生成时使用镜头画面和静态表演信息自动组成图片提示词";
                    return (
                        <article key={shot.id} className="grid gap-3 rounded-xl border border-border/70 bg-surface p-3 lg:grid-cols-[148px_minmax(0,1fr)_184px]">
                            <button type="button" className="relative aspect-video overflow-hidden rounded-lg border border-border/60 bg-foreground/[.035]" disabled={!artifact?.resourceId} onClick={() => artifact && onPreviewImage(artifact)} aria-label={`查看${shot.title}分镜图`}>
                                {artifact?.resourceId ? <img src={resourceFileUrl(artifact.resourceId)} alt={`${shot.title}分镜图`} className="h-full w-full object-cover" loading="lazy" /> : <span className="grid h-full place-items-center text-foreground/24"><ImageIcon className="size-7" /></span>}
                            </button>

                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong className="text-sm">镜头 {String(index + 1).padStart(2, "0")} · {shot.title || "未命名"}</strong>
                                    <span className="text-[var(--fs-tiny)] text-foreground/42">计划 {formatDuration(shot.durationMs)}</span>
                                    {shot.status === "confirmed" ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[var(--fs-micro)] text-emerald-500">提示词已确认</span> : <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[var(--fs-micro)] text-amber-500">提示词待确认</span>}
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">{revision?.plotDescription || shot.description || "尚未填写镜头画面"}</p>
                                <div className="mt-2 grid gap-2 xl:grid-cols-2">
                                    <PromptBlock label="分镜画面提示词（图片）" value={imagePrompt} />
                                    <PromptBlock label="视频提示词（后续视频）" value={revision?.videoPrompt || "尚未填写"} />
                                </div>
                                {revision?.action ? <details className="mt-2 rounded-lg border border-border/60 bg-foreground/[.02] px-2.5 py-2"><summary className="cursor-pointer text-[var(--fs-tiny)] font-medium text-foreground/55">表演动作与时间节拍（只用于视频）</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground/52">{revision.action}</p></details> : null}
                            </div>

                            <div className="flex flex-col items-stretch justify-between gap-2 lg:items-end">
                                <ArtifactStatus artifact={artifact} taskStatus={submitting ? "queued" : undefined} />
                                <Button icon={<Sparkles className="size-3.5" />} loading={submitting} disabled={busy || shot.status !== "confirmed"} onClick={() => onGenerateShot(shot)}>{ready ? "重新生成分镜图" : "生成分镜图"}</Button>
                                {artifact?.resourceId ? <Button type="text" size="small" icon={<ImageIcon className="size-3.5" />} onClick={() => onPreviewImage(artifact)}>查看图片</Button> : null}
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

export function SmartFilmVideoBoard({ detail, shots, readyCount, targetSeconds, generating, latestResourceId, onBack, onGenerate, onDownload }: {
    detail: ProjectDetail;
    shots: ProjectShot[];
    readyCount: number;
    targetSeconds: number;
    generating: boolean;
    latestResourceId?: string;
    onBack: () => void;
    onGenerate: () => void;
    onDownload: () => void;
}) {
    const allReady = shots.length > 0 && readyCount === shots.length;
    return (
        <section className="min-h-0 overflow-auto px-4 py-4 thin-scrollbar">
            <header className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-foreground/[.06] px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/55">步骤 2 / 2</span>
                        <strong className="text-sm">生成整片视频</strong>
                        <span className="text-xs text-foreground/42">使用 {readyCount}/{shots.length} 张分镜图 · 目标 {formatDuration(targetSeconds * 1000)}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground/48">这一步只生成一条完整视频，不生成分镜图，也不逐镜生成视频。分镜图、镜头时长和动作节拍会共同作为视频生成依据。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<ArrowLeft className="size-4" />} onClick={onBack}>返回分镜图</Button>
                    <Button icon={<Download className="size-4" />} disabled={!latestResourceId} onClick={onDownload}>下载整片视频</Button>
                    <Button type="primary" icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <Video className="size-4" />} loading={generating} disabled={!allReady} onClick={onGenerate}>{latestResourceId ? "重新生成整片视频" : "生成整片视频"}</Button>
                </div>
            </header>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-xl border border-border/70 bg-surface p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium"><Clapperboard className="size-4" />分镜顺序与计划时长</div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {shots.map((shot, index) => {
                            const artifact = currentArtifact(detail, shot.id, "storyboard");
                            return <div key={shot.id} className="overflow-hidden rounded-lg border border-border/60 bg-foreground/[.025]">
                                <div className="aspect-video bg-foreground/[.04]">{artifact?.resourceId ? <img src={resourceFileUrl(artifact.resourceId)} alt={`${shot.title}分镜图`} className="h-full w-full object-cover" loading="lazy" /> : <span className="grid h-full place-items-center text-foreground/25"><ImageIcon className="size-6" /></span>}</div>
                                <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs"><strong>镜头 {String(index + 1).padStart(2, "0")}</strong><span className="text-foreground/45">计划 {formatDuration(shot.durationMs)}</span></div>
                            </div>;
                        })}
                    </div>
                </div>
                <div className="flex min-h-56 items-center justify-center rounded-xl border border-border/70 bg-surface p-3">
                    {latestResourceId ? <video src={resourceFileUrl(latestResourceId)} controls className="max-h-[420px] w-full rounded-lg" preload="metadata" /> : <div className="text-center text-foreground/38"><Film className="mx-auto size-10" /><p className="mt-2 text-xs">还没有生成整片视频</p><p className="mt-1 text-[var(--fs-tiny)] text-foreground/30">分镜图全部就绪后即可生成</p></div>}
                </div>
            </div>
        </section>
    );
}

function PromptBlock({ label, value }: { label: string; value: string }) {
    return <div className="rounded-lg border border-border/60 bg-foreground/[.02] px-2.5 py-2"><div className="text-[var(--fs-micro)] font-medium text-foreground/38">{label}</div><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground/58">{value}</p></div>;
}
