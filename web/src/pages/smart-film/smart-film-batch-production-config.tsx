import { Button, InputNumber, Select, Tag } from "antd";

import type { SmartFilmBatch } from "@/services/api/smart-film-batches";

type ProductionMode = "fixed" | "smart" | "";

export function SmartFilmBatchProductionConfig({
    batch,
    effectiveVideoModel,
    currentSkillSnapshot,
    productionLocked,
    skillDirty,
    skillDraftId,
    skillsLoading,
    skillSaving,
    busy,
    productionSaving,
    skillOptions,
    productionConfigValid,
    productionDraftMatchesSaved,
    productionModeDraft,
    shotCountDraft,
    shotDurationsDraft,
    productionMaxClipSeconds,
    productionDurationOptions,
    targetDurationDraft,
    productionMaxTargetSeconds,
    onSkillDraftChange,
    onApplySkill,
    onManageSkills,
    onProductionModeChange,
    onShotCountChange,
    onShotDurationChange,
    onTargetDurationChange,
}: {
    batch: SmartFilmBatch;
    effectiveVideoModel: string;
    currentSkillSnapshot: SmartFilmBatch["config"]["skillSnapshot"];
    productionLocked: boolean;
    skillDirty: boolean;
    skillDraftId: string;
    skillsLoading: boolean;
    skillSaving: boolean;
    busy: string;
    productionSaving: boolean;
    skillOptions: Array<{ value: string; label: string }>;
    productionConfigValid: boolean;
    productionDraftMatchesSaved: boolean;
    productionModeDraft: ProductionMode;
    shotCountDraft: number | null;
    shotDurationsDraft: number[];
    productionMaxClipSeconds: number;
    productionDurationOptions: number[];
    targetDurationDraft: number | null;
    productionMaxTargetSeconds: number;
    onSkillDraftChange: (value: string) => void;
    onApplySkill: () => void;
    onManageSkills: () => void;
    onProductionModeChange: (value: ProductionMode) => void;
    onShotCountChange: (value: number | null) => void;
    onShotDurationChange: (index: number, value: number) => void;
    onTargetDurationChange: (value: number | null) => void;
}) {
    return (
        <>
            <section className="smart-film-production-config smart-film-skill-edit">
                <div className="smart-film-production-config-head">
                    <div>
                        <strong>项目制作技能</strong>
                        <span>一次多剧本生成只能固定一个完整 Skill 包。已有项目开始制作后不可更换。</span>
                    </div>
                    <Tag bordered={false}>{productionLocked ? "已锁定" : skillDirty ? "有修改" : currentSkillSnapshot ? "已固定" : "平台默认"}</Tag>
                </div>
                <div className="smart-film-production-mode-row">
                    <label>
                        <span>唯一 Skill</span>
                        {productionLocked ? (
                            <div className="smart-film-skill-locked-copy">{currentSkillSnapshot ? `${currentSkillSnapshot.name}${currentSkillSnapshot.version ? ` · ${currentSkillSnapshot.version}` : ""}` : "平台默认技能规则"}</div>
                        ) : (
                            <Select
                                allowClear
                                showSearch
                                value={skillDraftId || undefined}
                                loading={skillsLoading}
                                disabled={Boolean(busy) || productionSaving || skillSaving}
                                optionFilterProp="label"
                                placeholder="选择本次项目唯一技能"
                                options={skillOptions}
                                onChange={(value) => onSkillDraftChange(value || "")}
                                aria-label="更换本次项目唯一技能"
                            />
                        )}
                    </label>
                    <div className="smart-film-skill-edit-actions">
                        {!productionLocked ? (
                            <Button type="primary" loading={skillSaving} disabled={!skillDirty || Boolean(busy) || productionSaving || skillsLoading} onClick={onApplySkill}>
                                应用技能
                            </Button>
                        ) : null}
                        <Button disabled={Boolean(busy) || skillSaving} onClick={onManageSkills}>
                            管理技能
                        </Button>
                    </div>
                </div>
                <p className="smart-film-skill-edit-note">
                    {productionLocked ? "已有项目进入制作，技能和版本已锁定。" : batch.scripts.length ? "更换技能不会自动重写已有剧本；建议更换后重新生成剧本，再创建项目。" : "选择并应用后，后续剧本、资产、分镜和视频都会使用这一个 Skill。"}
                </p>
            </section>

            {batch.scripts.length ? (
                <section className="smart-film-production-config">
                    <div className="smart-film-production-config-head">
                        <div>
                            <strong>制作规格与分镜策略</strong>
                            <span>剧本确认后再决定分镜。模型已在创建本次项目时固定，后续不再重复选择。</span>
                        </div>
                        <Tag bordered={false}>{productionLocked ? "已锁定" : productionSaving ? "保存中" : productionConfigValid && productionDraftMatchesSaved ? "已设置" : productionModeDraft ? "待完善" : "待设置"}</Tag>
                    </div>
                    <div className="smart-film-production-mode-row">
                        <label>
                            <span>分镜方式</span>
                            <Select
                                value={productionModeDraft || undefined}
                                disabled={productionLocked || Boolean(busy)}
                                placeholder="选择分镜方式"
                                onChange={(value) => onProductionModeChange(value as ProductionMode)}
                                options={[
                                    { value: "fixed", label: "固定分镜：一张分镜图对应一个镜头视频" },
                                    { value: "smart", label: "智能整片：由模型决定镜头，全部镜头图合成一个视频" },
                                ]}
                            />
                        </label>
                        {!productionModeDraft ? <p>先生成并挑选剧本，再选择固定分镜或智能整片。</p> : null}
                    </div>
                    {productionModeDraft === "fixed" ? (
                        <div className="smart-film-production-fixed">
                            <label>
                                <span>镜头数量</span>
                                <InputNumber min={1} max={200} precision={0} value={shotCountDraft} disabled={productionLocked || Boolean(busy)} onChange={onShotCountChange} addonAfter="镜" />
                            </label>
                            <div className="smart-film-production-duration-heading">
                                <strong>逐镜时长</strong>
                                <span>当前视频模型单镜上限 {productionMaxClipSeconds} 秒；每个分镜图会对应一个镜头视频。</span>
                            </div>
                            <div className="smart-film-duration-grid">
                                {shotDurationsDraft.map((duration, index) => (
                                    <label key={index}>
                                        <span>镜头 {index + 1}</span>
                                        <Select
                                            value={duration}
                                            disabled={productionLocked || Boolean(busy)}
                                            options={productionDurationOptions.map((value) => ({ value, label: `${value} 秒` }))}
                                            onChange={(value) => onShotDurationChange(index, value)}
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {productionModeDraft === "smart" ? (
                        <div className="smart-film-production-smart">
                            <label>
                                <span>目标成片总时长</span>
                                <InputNumber min={1} max={productionMaxTargetSeconds} precision={0} value={targetDurationDraft} disabled={productionLocked || Boolean(busy)} onChange={onTargetDurationChange} addonAfter="秒" />
                            </label>
                            <p>模型会根据剧本和总时长自动决定分镜数量。当前视频模型单次最多生成 {productionMaxTargetSeconds} 秒，分镜图确认后会把全部镜头图作为一个完整视频生成。</p>
                        </div>
                    ) : null}
                    <div className="smart-film-production-config-foot">
                        <span>视频模型：{batch.config.defaultVideoModel || effectiveVideoModel || "未配置"}</span>
                        <span>
                            {productionLocked
                                ? "项目已经开始制作，制作规格不可再修改。"
                                : productionSaving
                                  ? "正在自动保存…"
                                  : productionConfigValid && productionDraftMatchesSaved
                                    ? "已自动保存"
                                    : productionConfigValid
                                      ? "等待同步…"
                                      : "选择后自动保存"}
                        </span>
                    </div>
                </section>
            ) : null}
        </>
    );
}
