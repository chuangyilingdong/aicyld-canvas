import { App, Button } from "antd";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clapperboard, Download, Film, Image as ImageIcon, LoaderCircle, Save, Sparkles, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectDetail, ProjectShot, ShotArtifact, ShotRevision } from "@/services/api/projects";

import { autoMentionShotAssetReferences, buildShotAssetReferenceContext, ensureShotAssetMentionPrompt } from "./workflow-shot-references";
import { ArtifactStatus, currentArtifact, currentRevision, formatDuration } from "./workflow-shared";

type PromptSaveStatus = "draft" | "confirmed";

export function SmartFilmStoryboardBoard({ detail, shots, readyCount, busy, submittingShotIds, onConfirmShot, onGenerateAll, onGenerateShot, onPreviewImage, onNext }: {
    detail: ProjectDetail;
    shots: ProjectShot[];
    readyCount: number;
    busy: boolean;
    submittingShotIds: Set<string>;
    onConfirmShot: (shot: ProjectShot) => Promise<void>;
    onGenerateAll: () => void;
    onGenerateShot: (shot: ProjectShot) => void;
    onPreviewImage: (artifact: ShotArtifact) => void;
    onNext: () => void;
}) {
    const { message } = App.useApp();
    const [confirmingShotId, setConfirmingShotId] = useState<string>();
    const allReady = shots.length > 0 && readyCount === shots.length;
    const confirmedCount = shots.filter((shot) => shot.status === "confirmed").length;
    const allConfirmed = shots.length > 0 && confirmedCount === shots.length;
    const assetTitles = new Map(detail.assets.map((asset) => [asset.id, asset.title]));

    const confirmShot = async (shot: ProjectShot) => {
        setConfirmingShotId(shot.id);
        try {
            await onConfirmShot(shot);
            message.success("本镜提示词已确认");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "本镜提示词确认失败");
        } finally {
            setConfirmingShotId(undefined);
        }
    };

    return (
        <section className="h-full min-h-0 overflow-y-auto px-4 py-4 thin-scrollbar">
            <header className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-foreground/[.06] px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/55">步骤 1 / 2</span>
                        <strong className="text-sm">生成分镜图</strong>
                        <span className="text-xs text-foreground/42">已确认 {confirmedCount}/{shots.length} · 分镜图已就绪 {readyCount}/{shots.length}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground/48">请逐个确认每个镜头的提示词。确认后再生成该镜头分镜图；全部镜头确认并生成后，才能进入整片视频。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<Sparkles className="size-4" />} loading={busy} disabled={allReady || !allConfirmed} onClick={onGenerateAll}>{allReady ? "全部分镜图已生成" : "生成缺失分镜图"}</Button>
                    <Button type="primary" icon={<ArrowRight className="size-4" />} disabled={!allReady || !allConfirmed || busy} onClick={onNext}>下一步：整片视频</Button>
                </div>
            </header>

            <div className="grid gap-3">
                {shots.map((shot, index) => {
                    const revision = currentRevision(detail, shot);
                    const artifact = currentArtifact(detail, shot.id, "storyboard");
                    const ready = Boolean(artifact?.resourceId && artifact.status === "ready");
                    const submitting = submittingShotIds.has(shot.id);
                    const confirming = confirmingShotId === shot.id;
                    const imagePrompt = revision?.imagePrompt || "未单独填写；生成时使用镜头画面和静态表演信息自动组成图片提示词";
                    return (
                        <article key={shot.id} className="grid gap-3 rounded-xl border border-border/70 bg-surface p-3 lg:grid-cols-[220px_minmax(0,1fr)_170px]">
                            <button type="button" className="relative aspect-video self-start overflow-hidden rounded-lg border border-border/60 bg-black/20" disabled={!artifact?.resourceId} onClick={() => artifact && onPreviewImage(artifact)} aria-label={`查看${shot.title}分镜图`}>
                                {artifact?.resourceId ? <img src={resourceFileUrl(artifact.resourceId)} alt={`${shot.title}分镜图`} className="h-full w-full object-contain" loading="lazy" /> : <span className="grid h-full place-items-center text-foreground/24"><ImageIcon className="size-7" /></span>}
                            </button>

                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong className="text-sm">镜头 {String(index + 1).padStart(2, "0")} · {shot.title || "未命名"}</strong>
                                    <span className="text-[var(--fs-tiny)] text-foreground/42">计划 {formatDuration(shot.durationMs)}</span>
                                    {shot.status === "confirmed" ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[var(--fs-micro)] text-emerald-500">本镜已确认</span> : <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[var(--fs-micro)] text-amber-500">本镜待确认</span>}
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">{readablePrompt(revision?.plotDescription || shot.description || "尚未填写镜头画面", assetTitles)}</p>
                                <div className="mt-2">
                                    <PromptBlock label="分镜画面提示词（图片）" value={readablePrompt(imagePrompt, assetTitles)} />
                                </div>
                            </div>

                            <div className="flex flex-col items-stretch justify-between gap-2 lg:items-end">
                                <ArtifactStatus artifact={artifact} taskStatus={submitting ? "queued" : undefined} />
                                <Button type={shot.status === "confirmed" ? "default" : "primary"} icon={<CheckCircle2 className="size-3.5" />} loading={confirming} disabled={busy || shot.status === "confirmed"} onClick={() => void confirmShot(shot)}>{shot.status === "confirmed" ? "本镜已确认" : "确认本镜"}</Button>
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

export function SmartFilmVideoBoard({ detail, shots, readyCount, targetSeconds, generating, latestResourceId, onBack, onSaveShotPrompt, onGenerate, onDownload }: {
    detail: ProjectDetail;
    shots: ProjectShot[];
    readyCount: number;
    targetSeconds: number;
    generating: boolean;
    latestResourceId?: string;
    onBack: () => void;
    onSaveShotPrompt: (shot: ProjectShot, videoPrompt: string, status: PromptSaveStatus) => Promise<void>;
    onGenerate: () => void;
    onDownload: () => void;
}) {
    const allReady = shots.length > 0 && readyCount === shots.length;
    const confirmedCount = shots.filter((shot) => shot.status === "confirmed").length;
    const allConfirmed = shots.length > 0 && confirmedCount === shots.length;
    const canGenerate = allReady && allConfirmed && !generating;

    return (
        <section className="h-full min-h-0 overflow-y-auto px-4 py-4 thin-scrollbar">
            <header className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-foreground/[.06] px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/55">步骤 2 / 2</span>
                        <strong className="text-sm">生成整片视频</strong>
                        <span className="text-xs text-foreground/42">使用 {readyCount}/{shots.length} 张分镜图 · 目标 {formatDuration(targetSeconds * 1000)}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground/48">请逐个检查并编辑本镜视频提示词，再逐镜确认。已确认 {confirmedCount}/{shots.length}；全部确认后才能生成 1 条完整视频。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<ArrowLeft className="size-4" />} onClick={onBack}>返回分镜图</Button>
                    <Button icon={<Download className="size-4" />} disabled={!latestResourceId} onClick={onDownload}>下载整片视频</Button>
                    <Button type="primary" icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <Video className="size-4" />} loading={generating} disabled={!canGenerate} onClick={onGenerate}>{latestResourceId ? "重新生成整片视频" : "生成整片视频"}</Button>
                </div>
            </header>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-xl border border-border/70 bg-surface p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                        <span className="flex items-center gap-2"><Clapperboard className="size-4" />参考分镜清单</span>
                        <span className="text-foreground/38">每个镜头单独一排；提示词和确认均只作用于本镜</span>
                    </div>
                    <div className="grid gap-3">
                        {shots.map((shot, index) => (
                            <SmartFilmVideoShotRow
                                key={shot.id}
                                detail={detail}
                                shot={shot}
                                index={index}
                                artifact={currentArtifact(detail, shot.id, "storyboard")}
                                revision={currentRevision(detail, shot)}
                                targetSeconds={targetSeconds}
                                busy={generating}
                                onSave={onSaveShotPrompt}
                            />
                        ))}
                    </div>
                </div>
                <div className="flex min-h-56 items-start justify-center rounded-xl border border-border/70 bg-surface p-3 xl:sticky xl:top-3">
                    {latestResourceId ? <video src={resourceFileUrl(latestResourceId)} controls className="max-h-[420px] w-full rounded-lg" preload="metadata" /> : <div className="py-12 text-center text-foreground/38"><Film className="mx-auto size-10" /><p className="mt-2 text-xs">还没有生成整片视频</p><p className="mt-1 text-[var(--fs-tiny)] text-foreground/30">{allConfirmed ? "所有镜头已确认，可以开始生成" : `还剩 ${shots.length - confirmedCount} 个镜头待确认`}</p></div>}
                </div>
            </div>
        </section>
    );
}

function SmartFilmVideoShotRow({ detail, shot, index, artifact, revision, targetSeconds, busy, onSave }: {
    detail: ProjectDetail;
    shot: ProjectShot;
    index: number;
    artifact?: ShotArtifact;
    revision?: ShotRevision;
    targetSeconds: number;
    busy: boolean;
    onSave: (shot: ProjectShot, videoPrompt: string, status: PromptSaveStatus) => Promise<void>;
}) {
    const { message } = App.useApp();
    const context = useMemo(() => buildShotAssetReferenceContext(detail, shot.id), [detail, shot.id]);
    const initialPrompt = useMemo(() => normalizePrompt(revision?.videoPrompt || revision?.plotDescription || shot.description || "", context.mentionReferences), [context.mentionReferences, revision?.plotDescription, revision?.videoPrompt, shot.description]);
    const [prompt, setPrompt] = useState(initialPrompt);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState<PromptSaveStatus>();
    const [selection, setSelection] = useState({ start: initialPrompt.length, end: initialPrompt.length });
    const [caretRequest, setCaretRequest] = useState<{ offset: number; key: number } | null>(null);
    const ready = Boolean(artifact?.resourceId && artifact.status === "ready");
    const confirmed = shot.status === "confirmed" && !dirty;

    useEffect(() => {
        setPrompt(initialPrompt);
        setDirty(false);
    }, [initialPrompt, revision?.id, shot.id]);

    const savePrompt = async (status: PromptSaveStatus) => {
        const normalized = normalizePrompt(prompt, context.mentionReferences);
        if (!normalized.trim()) {
            message.error("视频提示词不能为空");
            return;
        }
        setSaving(status);
        try {
            await onSave(shot, normalized, status);
            setPrompt(normalized);
            setDirty(false);
            message.success(status === "confirmed" ? "本镜参考分镜已确认" : "本镜视频提示词已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "本镜提示词保存失败");
        } finally {
            setSaving(undefined);
        }
    };

    const insertReference = (reference: typeof context.mentionReferences[number]) => {
        const token = canvasResourceMentionToken(reference);
        const start = Math.min(selection.start, prompt.length);
        const end = Math.min(selection.end, prompt.length);
        const nextPrompt = `${prompt.slice(0, start)}${token}${prompt.slice(end)}`;
        setPrompt(nextPrompt);
        setDirty(nextPrompt !== initialPrompt);
        const offset = start + token.length;
        setSelection({ start: offset, end: offset });
        setCaretRequest({ offset, key: Date.now() });
    };

    return (
        <article className={`grid gap-3 rounded-xl border bg-foreground/[.025] p-3 lg:grid-cols-[220px_minmax(0,1fr)_160px] ${confirmed ? "border-emerald-500/35" : "border-border/60"}`}>
            <div className="relative aspect-video self-start overflow-hidden rounded-lg border border-border/60 bg-foreground/[.04]">
                {artifact?.resourceId ? <img src={resourceFileUrl(artifact.resourceId)} alt={`${shot.title}分镜图`} className="h-full w-full object-contain" loading="lazy" /> : <span className="grid h-full place-items-center text-foreground/25"><ImageIcon className="size-7" /></span>}
            </div>

            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">镜头 {String(index + 1).padStart(2, "0")} · {shot.title || "未命名"}</strong>
                    <span className="text-[var(--fs-tiny)] text-foreground/42">计划 {formatDuration(shot.durationMs)} / 全片 {targetSeconds} 秒</span>
                    {confirmed ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[var(--fs-micro)] text-emerald-500">本镜已确认</span> : <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[var(--fs-micro)] text-amber-500">{dirty ? "有修改待确认" : ready ? "参考图待确认" : "分镜图未就绪"}</span>}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                    <label className="text-[var(--fs-micro)] font-medium text-foreground/48">视频提示词（仅本镜）</label>
                    <span className={`text-[var(--fs-micro)] ${dirty ? "text-amber-500" : "text-foreground/30"}`}>{dirty ? "有未保存修改" : "输入 @ 精确引用本镜资产图片"}</span>
                </div>
                <CanvasResourceMentionTextarea
                    value={prompt}
                    references={context.mentionReferences}
                    onChange={(value) => {
                        setPrompt(value);
                        setDirty(value !== initialPrompt);
                    }}
                    onSelectionRangeChange={setSelection}
                    caretRequest={caretRequest}
                    sendOnEnter={false}
                    containerClassName="workflow-shot-mention-container mt-1"
                    className="thin-scrollbar workflow-shot-mention-editor"
                    placeholder={context.mentionReferences.length ? "描述本镜动作、运镜和节奏；输入 @ 选择当前镜头绑定的资产图片" : "描述本镜动作、运镜和节奏；先在镜头资产中绑定角色或场景，才能用 @ 精确引用"}
                    aria-label="本镜视频提示词，可使用 @ 引用当前镜头绑定的资产图片"
                />

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[var(--fs-micro)] text-foreground/38">本镜可引用（点击插入光标位置）：</span>
                    {context.mentionReferences.length ? context.mentionReferences.map((reference) => (
                        <button key={reference.id} type="button" className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/50 px-1.5 py-0.5 text-[var(--fs-micro)] text-foreground/60 transition-colors hover:border-foreground/25 hover:text-foreground" title={`在光标处插入 @${reference.title || reference.label}`} onClick={() => insertReference(reference)}>
                            {reference.previewUrl ? <img src={reference.previewUrl} alt="" className="size-4 rounded-full object-cover" /> : <ImageIcon className="size-3" />}
                            <span className="max-w-32 truncate">@{reference.title || reference.label}</span>
                        </button>
                    )) : <span className="inline-flex items-center gap-1 text-[var(--fs-micro)] text-amber-500"><AlertTriangle className="size-3" />未绑定资产，请先到“角色与资产”绑定</span>}
                </div>
                {revision?.action ? <details className="mt-2 border-t border-border/50 pt-2"><summary className="cursor-pointer text-[var(--fs-micro)] text-foreground/38">动作与时间节拍（不属于可编辑视频提示词）</summary><p className="mt-1 whitespace-pre-wrap text-[var(--fs-tiny)] leading-5 text-foreground/50">{revision.action}</p></details> : null}
            </div>

            <div className="flex flex-col items-stretch justify-between gap-2 lg:items-end">
                <ArtifactStatus artifact={artifact} />
                <Button icon={<Save className="size-3.5" />} loading={saving === "draft"} disabled={busy || !dirty} onClick={() => void savePrompt("draft")}>保存修改</Button>
                <Button type={confirmed ? "default" : "primary"} icon={<CheckCircle2 className="size-3.5" />} loading={saving === "confirmed"} disabled={busy || confirmed || !ready} onClick={() => void savePrompt("confirmed")}>{confirmed ? "本镜已确认" : "确认本镜"}</Button>
            </div>
        </article>
    );
}

function normalizePrompt(prompt: string, references: ReturnType<typeof buildShotAssetReferenceContext>["mentionReferences"]) {
    return ensureShotAssetMentionPrompt(autoMentionShotAssetReferences(prompt.trim(), references), references);
}

function PromptBlock({ label, value }: { label: string; value: string }) {
    return <div className="rounded-lg border border-border/60 bg-foreground/[.02] px-2.5 py-2"><div className="text-[var(--fs-micro)] font-medium text-foreground/38">{label}</div><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground/58">{value}</p></div>;
}

function readablePrompt(value: string, assetTitles: Map<string, string>) {
    return value.replace(/@\[asset:([^\]]+)\]/g, (_, assetId: string) => `@${assetTitles.get(assetId) || "关联资产"}`);
}
