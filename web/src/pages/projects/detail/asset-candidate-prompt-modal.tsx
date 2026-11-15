import { Input, Modal } from "antd";

import type { ProjectAssetCandidate } from "@/services/api/projects";
import { categoryLabel } from "./shared";

export function assetCandidatePromptPreview(candidate: ProjectAssetCandidate) {
    return assetCandidatePromptValue(candidate) || "等待补充资产提示词";
}

export function assetCandidatePromptValue(candidate: ProjectAssetCandidate) {
    try {
        const details = JSON.parse(candidate.detailsJson || "{}") as Record<string, unknown>;
        const value = details.prompt || details.description || details.appearance || details.consistencyPrompt;
        return typeof value === "string" ? value.trim() : "";
    } catch {
        return "";
    }
}

export function assetCandidateImagePrompt(candidate: ProjectAssetCandidate, projectStyle: string) {
    let details: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(candidate.detailsJson || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details = parsed as Record<string, unknown>;
    } catch {
        // A malformed candidate still has its name and can be generated from that.
    }
    const description = ["prompt", "description", "appearance", "consistencyPrompt"]
        .map((key) => typeof details[key] === "string" ? String(details[key]).trim() : "")
        .find(Boolean) || candidate.name;
    return [
        `生成一张用于短视频制作的${categoryLabel(candidate.category)}资产设定图。`,
        `资产名称：${candidate.name}`,
        `外观与设定：${description}`,
        projectStyle ? `项目画风：${projectStyle}` : "",
        "画面只展示资产本身，构图完整、背景干净、光线清晰，适合作为后续分镜的视觉参考。",
        "不要出现文字、水印、边框、拼贴说明或多主体。",
    ].filter(Boolean).join("\n");
}

export function AssetCandidatePromptModal({ candidate, draft, saving, onChange, onClose, onSave }: {
    candidate: ProjectAssetCandidate | null;
    draft: string;
    saving: boolean;
    onChange: (value: string) => void;
    onClose: () => void;
    onSave: () => void;
}) {
    return (
        <Modal
            className="workspace-modal workspace-modal-compact"
            title={candidate ? `${candidate.name} · 资产提示词` : "资产提示词"}
            open={Boolean(candidate)}
            okText="保存提示词"
            cancelText="取消"
            okButtonProps={{ disabled: !draft.trim(), loading: saving }}
            onCancel={onClose}
            onOk={onSave}
        >
            <div className="grid gap-3">
                <p className="m-0 text-xs leading-5 text-foreground/48">先修改并保存资产外观、材质和关键特征，再生成资产图。后续镜头会使用这里的最新提示词。</p>
                <Input.TextArea value={draft} onChange={(event) => onChange(event.target.value)} autoSize={{ minRows: 7, maxRows: 16 }} maxLength={4000} showCount placeholder="填写资产提示词" />
            </div>
        </Modal>
    );
}
