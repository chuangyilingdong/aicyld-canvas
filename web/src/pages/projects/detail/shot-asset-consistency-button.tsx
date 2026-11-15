import { useMemo, useState } from "react";
import { Button, Modal, Tag } from "antd";
import { ShieldAlert } from "lucide-react";

import type { ProjectDetail, ProjectShot } from "@/services/api/projects";
import { checkShotAssetConsistency } from "./shot-asset-consistency";

export function ShotAssetConsistencyButton({ detail, shots, disabled, onSelectShot }: {
    detail: ProjectDetail;
    shots: ProjectShot[];
    disabled: boolean;
    onSelectShot: (shotId: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const issues = useMemo(() => checkShotAssetConsistency(detail, shots), [detail, shots]);
    const errors = issues.filter((issue) => issue.severity === "error").length;
    return (
        <>
            <Button size="small" danger={errors > 0} icon={<ShieldAlert className="size-3.5" />} disabled={disabled} onClick={() => setOpen(true)}>
                {issues.length ? `资产检查（${issues.length}）` : "资产检查正常"}
            </Button>
            <Modal open={open} title="多镜头资产一致性检查" width={760} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
                <p className="mb-4 text-xs leading-5 text-foreground/45">检查每个镜头当前脚本版本中的资产引用、资产版本和提示词 token。红色问题会在生图前阻止或提示处理，黄色提醒表示需要人工确认。</p>
                {issues.length ? <div className="shot-asset-consistency-list">{issues.map((issue, index) => <article key={`${issue.shotId}-${issue.code}-${index}`} className={issue.severity === "error" ? "is-error" : "is-warning"}><Tag color={issue.severity === "error" ? "red" : "orange"}>{issue.severity === "error" ? "问题" : "提醒"}</Tag><div><strong>{issue.shotTitle}</strong><p>{issue.message}</p></div><Button size="small" onClick={() => { onSelectShot(issue.shotId); setOpen(false); }}>定位镜头</Button></article>)}</div> : <div className="shot-asset-consistency-empty">当前所有镜头的资产引用正常。</div>}
            </Modal>
        </>
    );
}
