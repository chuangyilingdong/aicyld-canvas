import { Button, Dropdown, Popconfirm } from "antd";
import { Image as ImageIcon, MoveRight, Pencil, Sparkles, Trash2, UserRound, Volume2 } from "lucide-react";
import type { ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectAsset } from "@/services/api/projects";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";

import { textValue } from "./shared";

export function ProjectCharacterCard({ asset, folderItems, generating, confirming, removing, onOpen, onEdit, onGenerate, onConfirmVisual, onBindImages, onBindVoice, onMove, onRemove }: {
    asset: ProjectAsset;
    folderItems: Array<{ key: string; label: string }>;
    generating: boolean;
    confirming: boolean;
    removing: boolean;
    onOpen: () => void;
    onEdit: () => void;
    onGenerate: () => void;
    onConfirmVisual: () => void;
    onBindImages: () => void;
    onBindVoice: () => void;
    onMove: (folderId: string) => void;
    onRemove: () => void;
}) {
    const character = asset.character;
    const cover = character?.representations.find((item) => item.role === "turnaround_sheet") || character?.representations.find((item) => item.role === "primary") || character?.representations.find((item) => item.role === "front") || character?.representations[0];
    const role = textValue(character?.definition.role) || "未填写剧情定位";
    const appearance = textValue(character?.definition.appearance) || textValue(character?.definition.consistencyPrompt) || "角色设定可留空；确认角色图片后即可使用";
    const pendingVisual = character?.visualStatus === "pending_confirmation";
    const hasCover = Boolean(cover);
    const imageStatus = pendingVisual ? "角色图片待确认" : hasCover ? "角色图片已固定" : "角色图片未绑定";
    const voiceStatus = character?.voiceStatus === "ready" ? `声音已绑定 · ${character.voice?.profile.name}` : character?.voiceStatus === "unavailable" ? "声音需处理" : "声音未绑定";
    const readinessLabel = pendingVisual ? "图片待确认" : hasCover ? character?.voiceStatus === "ready" ? "可直接用于生成" : "角色已固定" : "待添加角色图";
    const imageAction = pendingVisual ? "确认" : hasCover ? "更换" : "添加";
    const imageActionHandler = pendingVisual ? onConfirmVisual : onBindImages;
    return (
        <AssetLibraryCard className="project-character-card">
            <AssetLibraryCardMedia className="relative aspect-[3/2] overflow-hidden bg-foreground/[.045]">
                <button type="button" className="project-asset-media-button" onClick={onOpen} aria-label={`查看角色卡：${asset.title}`}>
                    {cover ? <CachedResourceImage storageKey={`resource:${cover.resourceId}`} src={resourceFileUrl(cover.resourceId)} alt={asset.title} loading="lazy" decoding="async" className="h-full w-full object-contain p-1" fallback={<div className="grid h-full place-items-center"><span className="grid size-14 place-items-center rounded-lg border border-border/70 bg-background/75 text-foreground/24"><UserRound className="size-7" /></span></div>} /> : <div className="grid h-full place-items-center"><span className="grid size-14 place-items-center rounded-lg border border-border/70 bg-background/75 text-foreground/24"><UserRound className="size-7" /></span></div>}
                </button>
                <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-2">
                    <span className="rounded bg-black/60 px-1.5 py-0.5 text-[var(--fs-micro)] font-medium text-white">角色卡 · v{character?.version || 1}</span>
                    <span className="rounded bg-black/60 px-1.5 py-0.5 text-[var(--fs-micro)] text-white">{readinessLabel}</span>
                </div>
            </AssetLibraryCardMedia>
            <div className="p-3">
                <div className="flex items-start justify-between gap-3"><button type="button" className="project-character-title-button" onClick={onOpen}><h3 className="truncate text-sm font-semibold">{asset.title}</h3><p className="mt-0.5 truncate text-[var(--fs-label)] text-foreground/48">{role}</p></button><Button type="text" size="small" className="!h-7 !px-1.5" icon={<Pencil className="size-3.5" />} onClick={onEdit} aria-label={`编辑 ${asset.title}`} /></div>
                <p className="mt-2 line-clamp-2 min-h-9 text-[var(--fs-label)] leading-[18px] text-foreground/55">{appearance}</p>
                <div className="mt-2 grid gap-1.5">
                    <StatusLine icon={<ImageIcon className="size-3.5" />} ready={hasCover && !pendingVisual} label={imageStatus} action={confirming ? "确认中" : imageAction} disabled={confirming} onClick={imageActionHandler} />
                    <StatusLine icon={<Volume2 className="size-3.5" />} ready={character?.voiceStatus === "ready"} label={voiceStatus} action={character?.voiceStatus === "ready" ? "调整" : "选择"} onClick={onBindVoice} />
                </div>
                <div className="mt-3 flex min-w-0 gap-2 border-t border-border/60 pt-2">
                    <Button size="small" className="min-w-0 flex-1" icon={<ImageIcon className="size-3.5" />} loading={confirming} disabled={removing || generating} onClick={pendingVisual ? onConfirmVisual : onBindImages}>{pendingVisual ? "确认角色图片" : hasCover ? "更换角色图片" : "添加角色图片"}</Button>
                    {hasCover ? <Button type="text" size="small" icon={<Sparkles className="size-3.5" />} loading={generating} disabled={removing || confirming} onClick={onGenerate} title="可选：用 AI 补充角色三视图" aria-label="生成角色三视图（可选）" /> : null}
                    <Dropdown trigger={["click"]} menu={{ selectedKeys: [asset.folderId || ""], items: folderItems, onClick: ({ key }) => onMove(key) }}><Button type="text" size="small" disabled={generating || confirming || removing} icon={<MoveRight className="size-3.5" />} aria-label={`移动 ${asset.title}`} /></Dropdown><Popconfirm title="移出项目角色？" description="已有画布或镜头引用时将无法移出。" okText="移出" cancelText="取消" onConfirm={onRemove}><Button type="text" danger size="small" loading={removing} disabled={generating || confirming} icon={<Trash2 className="size-3.5" />} aria-label={`移出 ${asset.title}`} /></Popconfirm>
                </div>
            </div>
        </AssetLibraryCard>
    );
}

function StatusLine({ icon, ready, label, action, disabled = false, onClick }: { icon: ReactNode; ready: boolean; label: string; action: string; disabled?: boolean; onClick: () => void }) {
    return <div className={`flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-[var(--fs-tiny)] ${ready ? "border-emerald-500/20 bg-emerald-500/[.06] text-emerald-700 dark:text-emerald-300" : "border-border/70 bg-foreground/[.025] text-foreground/48"}`}><span className="shrink-0">{icon}</span><span className="min-w-0 flex-1 truncate">{label}</span><button type="button" className="shrink-0 font-medium text-[var(--workspace-accent)] hover:underline disabled:opacity-45" disabled={disabled} onClick={onClick}>{action}</button></div>;
}
