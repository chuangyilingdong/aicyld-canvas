import { useEffect, useState } from "react";
import { Alert, Checkbox, Input, Modal } from "antd";

import { smartFilmBulkTitle, type SmartFilmBulkDialogKind } from "./batch-bulk-operations";

export type SmartFilmBulkDialogValue = {
    titleTemplate?: string;
    appendIndex?: boolean;
    creativeRequirement?: string;
};

type Props = {
    kind: SmartFilmBulkDialogKind | "";
    count: number;
    busy: boolean;
    onCancel: () => void;
    onSubmit: (value: SmartFilmBulkDialogValue) => void;
};

export function SmartFilmBatchBulkDialog({ kind, count, busy, onCancel, onSubmit }: Props) {
    const [titleTemplate, setTitleTemplate] = useState("");
    const [appendIndex, setAppendIndex] = useState(true);
    const [creativeRequirement, setCreativeRequirement] = useState("");

    useEffect(() => {
        if (!kind) return;
        setTitleTemplate("");
        setAppendIndex(count > 1);
        setCreativeRequirement("");
    }, [count, kind]);

    const copy = dialogCopy(kind, count);
    const titlePreview = titleTemplate.trim()
        ? Array.from({ length: Math.min(count, 2) }, (_, index) => smartFilmBulkTitle(titleTemplate, index, count, appendIndex)).join(" / ")
        : "";
    const canSubmit = kind === "title"
        ? Boolean(titleTemplate.trim())
        : kind === "creative"
            ? Boolean(creativeRequirement.trim())
            : true;

    return (
        <Modal
            open={Boolean(kind)}
            title={copy.title}
            okText={copy.okText}
            cancelText="取消"
            confirmLoading={busy}
            okButtonProps={{ danger: copy.danger, disabled: !canSubmit }}
            destroyOnHidden
            onCancel={onCancel}
            onOk={() => onSubmit({
                ...(kind === "title" ? { titleTemplate, appendIndex } : {}),
                ...(kind === "creative" ? { creativeRequirement } : {}),
            })}
        >
            <div className="space-y-3 pt-2 text-sm text-foreground/70">
                <p>{copy.description}</p>
                {kind === "title" ? (
                    <>
                        <Input
                            autoFocus
                            maxLength={120}
                            value={titleTemplate}
                            placeholder="例如：城市夜行，或用 {n} 指定序号位置"
                            onChange={(event) => setTitleTemplate(event.target.value)}
                        />
                        <Checkbox checked={appendIndex} onChange={(event) => setAppendIndex(event.target.checked)}>
                            多条时自动追加两位序号
                        </Checkbox>
                        {titlePreview ? <div className="text-xs text-foreground/45">标题预览：{titlePreview}{count > 2 ? " …" : ""}</div> : null}
                    </>
                ) : null}
                {kind === "creative" ? (
                    <Input.TextArea
                        autoFocus
                        maxLength={2000}
                        showCount
                        autoSize={{ minRows: 5, maxRows: 10 }}
                        value={creativeRequirement}
                        placeholder="例如：开头 3 秒必须出现产品特写；人物只说一句话；结尾回到雨夜街景。"
                        onChange={(event) => setCreativeRequirement(event.target.value)}
                    />
                ) : null}
                {copy.alert ? <Alert type={copy.alert.type} showIcon message={copy.alert.message} /> : null}
            </div>
        </Modal>
    );
}

function dialogCopy(kind: SmartFilmBulkDialogKind | "", count: number) {
    switch (kind) {
        case "title":
            return {
                title: `批量修改 ${count} 条剧本标题`,
                description: "新标题会同步到剧本和已创建项目的章节标题。使用 {n} 可指定序号位置。",
                okText: "应用标题",
                danger: false,
                alert: null,
            };
        case "creative":
            return {
                title: `为 ${count} 条剧本应用创意要求`,
                description: "要求会以“统一创意要求”区块追加到每条剧本正文末尾；再次应用会替换该区块，不会重复堆叠。",
                okText: "应用创意要求",
                danger: false,
                alert: {
                    type: "warning" as const,
                    message: "修改已建项目的剧本正文后，对应分镜会回到待确认状态，需要重新检查提示词和资产引用。",
                },
            };
        case "regenerate":
            return {
                title: `重新生成 ${count} 条剧本草稿？`,
                description: "每条草稿会单独提交一个文本生成任务，并创建新的剧本版本。已有草稿内容会被替换。",
                okText: "确认重新生成",
                danger: true,
                alert: { type: "warning" as const, message: "此操作可能产生模型费用。仅在你明确需要重做时继续。" },
            };
        case "delete":
            return {
                title: `删除 ${count} 条剧本草稿？`,
                description: "只删除尚未创建视频项目的草稿，不会影响已创建项目或其他剧本。删除后不能恢复。",
                okText: "确认删除",
                danger: true,
                alert: null,
            };
        case "confirm_assets":
            return {
                title: `批量确认 ${count} 个项目的资产？`,
                description: "系统会确认所选项目中所有待确认资产候选，并使用每个候选当前选中的预览图生成正式资产。",
                okText: "确认全部资产",
                danger: false,
                alert: { type: "warning" as const, message: "请先确认候选图和角色设定已经检查完毕。此操作不会提交付费生成任务。" },
            };
        case "confirm_storyboard":
            return {
                title: `批量确认 ${count} 个项目的分镜？`,
                description: "系统会锁定所选项目当前所有镜头的提示词和资产引用，作为后续分镜图与视频生成依据。",
                okText: "确认全部分镜",
                danger: false,
                alert: { type: "info" as const, message: "此操作不会提交付费生成任务；确认后再次修改镜头会重新回到待确认状态。" },
            };
        default:
            return {
                title: "批量操作",
                description: "",
                okText: "确认",
                danger: false,
                alert: null,
            };
    }
}
