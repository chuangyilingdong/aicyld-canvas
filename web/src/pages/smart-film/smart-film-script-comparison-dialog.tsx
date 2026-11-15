import { Modal, Tag } from "antd";

import type { SmartFilmScript } from "@/services/api/smart-film-batches";
import { compareSmartFilmScript } from "./smart-film-script-comparison";

export function SmartFilmScriptComparisonDialog({ open, scripts, onClose }: { open: boolean; scripts: SmartFilmScript[]; onClose: () => void }) {
    return (
        <Modal open={open} title="对比候选剧本" width={1120} footer={null} onCancel={onClose} destroyOnHidden>
            <p className="mb-4 text-xs leading-5 text-foreground/45">从创意方向、开场钩子、正文和结尾四个维度比较，选择最适合继续制作的一条或两条。</p>
            <div className="smart-film-script-compare-grid">
                {scripts.map((script, index) => {
                    const comparison = compareSmartFilmScript(script);
                    return (
                        <article key={script.id} className="smart-film-script-compare-card">
                            <header>
                                <span className="smart-film-script-compare-index">方案 {String(index + 1).padStart(2, "0")}</span>
                                <h3>{script.title}</h3>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/40"><Tag bordered={false}>{script.projectId ? "已建项目" : script.status === "draft" ? "草稿" : "待处理"}</Tag><span>{comparison.characters} 字</span></div>
                            </header>
                            <CompareSection label="创意方向" value={comparison.direction} />
                            <CompareSection label="开场钩子" value={comparison.hook} />
                            <section className="smart-film-script-compare-section is-body"><span>正文</span><p>{comparison.body}</p></section>
                            <CompareSection label="结尾" value={comparison.ending} />
                            {!comparison.structured ? <div className="smart-film-script-compare-legacy">这条剧本由旧版生成，没有结构化标签，以上正文为原文。</div> : null}
                        </article>
                    );
                })}
            </div>
        </Modal>
    );
}

function CompareSection({ label, value }: { label: string; value: string }) {
    return <section className="smart-film-script-compare-section"><span>{label}</span><p>{value || "未标注"}</p></section>;
}
