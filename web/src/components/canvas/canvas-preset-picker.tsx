import { useMemo, useState } from "react";
import { Input, Popover } from "antd";
import { LayoutTemplate, Pencil, Plus, Search, Trash2, WandSparkles } from "lucide-react";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_BUILTIN_PRESETS, type CanvasPromptPreset } from "@/lib/prompts";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import type { CanvasGenerationMode } from "@/types/canvas";

export type { CanvasPromptPreset };

type PresetItem = CanvasPromptPreset & { custom?: boolean };

function suggestedPresetName(query: string, prompt: string) {
    return (query.trim() || prompt.trim().replace(/\s+/g, " ")).slice(0, 32);
}

export function CanvasPresetPicker({
    mode,
    skillReferences = [],
    open,
    onOpenChange,
    onSelect,
    currentPrompt = "",
    compact = false,
    dense = false,
    appearance = "default",
}: {
    mode: CanvasGenerationMode;
    skillReferences?: CanvasResourceReference[];
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onSelect: (preset: CanvasPromptPreset) => void;
    currentPrompt?: string;
    compact?: boolean;
    dense?: boolean;
    appearance?: "default" | "quiet";
}) {
    const theme = canvasThemes[useActiveTheme()];
    const customPresets = useCreationPreferencesStore((state) => state.preferences.customPresets);
    const saveCustomPreset = useCreationPreferencesStore((state) => state.saveCustomPreset);
    const renameCustomPreset = useCreationPreferencesStore((state) => state.renameCustomPreset);
    const removeCustomPreset = useCreationPreferencesStore((state) => state.removeCustomPreset);
    const [internalOpen, setInternalOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [savingNew, setSavingNew] = useState(false);
    const [newName, setNewName] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const actualOpen = open ?? internalOpen;
    const trimmedPrompt = currentPrompt.trim();

    const closeTransientEditors = () => {
        setSavingNew(false);
        setNewName("");
        setEditingId(null);
        setEditingName("");
    };
    const setOpen = (next: boolean) => {
        if (!next) {
            setQuery("");
            closeTransientEditors();
        }
        setInternalOpen(next);
        onOpenChange?.(next);
    };
    const beginSave = () => {
        setEditingId(null);
        setNewName(suggestedPresetName(query, trimmedPrompt));
        setSavingNew(true);
    };
    const confirmSave = () => {
        if (!trimmedPrompt) return;
        saveCustomPreset({ name: newName, prompt: trimmedPrompt, mode });
        closeTransientEditors();
        setQuery("");
    };
    const beginRename = (preset: PresetItem) => {
        setSavingNew(false);
        setEditingId(preset.id);
        setEditingName(preset.name);
    };
    const confirmRename = (presetId: string) => {
        if (!editingName.trim()) return;
        renameCustomPreset(presetId, editingName);
        setEditingId(null);
        setEditingName("");
    };

    const presets = useMemo<PresetItem[]>(() => {
        const custom: PresetItem[] = (customPresets || [])
            .filter((preset) => preset.modes.includes(mode))
            .map((preset) => ({ ...preset, source: "builtin" as const, custom: true }));
        const skills = skillReferences.flatMap((reference): PresetItem[] => {
            if (!reference.skill) return [];
            return [{
                id: `skill:${reference.skill.skillId}`,
                name: reference.skill.skillName,
                description: reference.skill.description || reference.skill.instruction || "已加入技能",
                prompt: `@${reference.skill.skillName} `,
                modes: ["text", "image", "video", "audio"],
                source: "skill",
            }];
        });
        const normalized = query.trim().toLocaleLowerCase();
        return [...custom, ...CANVAS_BUILTIN_PRESETS.filter((preset) => preset.modes.includes(mode)), ...skills]
            .filter((preset) => !normalized || `${preset.name} ${preset.description} ${preset.prompt}`.toLocaleLowerCase().includes(normalized));
    }, [customPresets, mode, query, skillReferences]);

    const content = (
        <div
            data-canvas-no-zoom
            className="canvas-preset-picker-menu w-[var(--panel-width-compact)] max-w-[calc(100vw-24px)]"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Input
                className="canvas-preset-picker-search"
                variant="borderless"
                autoFocus={!savingNew && !editingId}
                allowClear
                size="small"
                prefix={<Search className="size-3.5" />}
                placeholder="搜索预设或已加入技能"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
            />
            {trimmedPrompt ? (
                savingNew ? (
                    <div className="mt-1 rounded-md p-2" style={{ background: theme.accent.primarySoft }}>
                        <Input
                            size="small"
                            autoFocus
                            maxLength={40}
                            aria-label="预设名称"
                            placeholder="输入预设名称"
                            value={newName}
                            onChange={(event) => setNewName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.nativeEvent.isComposing) return;
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    confirmSave();
                                } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    closeTransientEditors();
                                }
                            }}
                        />
                        <div className="mt-1.5 flex justify-end gap-1">
                            <button type="button" className="rounded px-2 py-1 text-xs" style={{ color: theme.node.muted }} onClick={closeTransientEditors}>取消</button>
                            <button type="button" className="rounded px-2.5 py-1 text-xs font-medium" style={{ background: theme.accent.primary, color: theme.accent.onPrimary }} onClick={confirmSave}>保存</button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        aria-label="保存当前提示词为预设"
                        className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium"
                        style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}
                        onClick={beginSave}
                    >
                        <Plus className="size-3.5 shrink-0" />
                        <span className="truncate">保存当前提示词为预设</span>
                    </button>
                )
            ) : null}
            <div className="thin-scrollbar mt-1 max-h-72 space-y-0.5 overflow-y-auto overflow-x-hidden">
                {presets.length ? presets.map((preset) => {
                    if (preset.custom && editingId === preset.id) {
                        return (
                            <div key={preset.id} className="flex items-center gap-1.5 rounded-md px-2 py-1.5" style={{ background: theme.accent.primarySoft }}>
                                <Input
                                    size="small"
                                    autoFocus
                                    maxLength={40}
                                    aria-label={`编辑预设名称 ${preset.name}`}
                                    className="min-w-0 flex-1"
                                    value={editingName}
                                    onChange={(event) => setEditingName(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.nativeEvent.isComposing) return;
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            confirmRename(preset.id);
                                        } else if (event.key === "Escape") {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setEditingId(null);
                                        }
                                    }}
                                />
                                <button type="button" className="rounded px-2 py-1 text-xs font-medium" style={{ background: theme.accent.primary, color: theme.accent.onPrimary }} onClick={() => confirmRename(preset.id)}>保存</button>
                                <button type="button" className="rounded px-1.5 py-1 text-xs" style={{ color: theme.node.muted }} onClick={() => setEditingId(null)}>取消</button>
                            </div>
                        );
                    }
                    return (
                        <div key={preset.id} className="group relative flex min-w-0 items-center overflow-hidden">
                            <button
                                type="button"
                                className="canvas-preset-picker-option min-w-0 flex-1 overflow-hidden"
                                onClick={() => {
                                    onSelect(preset);
                                    setOpen(false);
                                }}
                            >
                                <span className="canvas-preset-picker-option-icon" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                                    <WandSparkles className="size-3.5" />
                                </span>
                                <span className="min-w-0 flex-1 overflow-hidden">
                                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold" style={{ color: theme.node.text }}>
                                        <span className="min-w-0 truncate">{preset.name}</span>
                                        <span className="shrink-0 text-[var(--fs-micro)]" style={{ color: theme.accent.primary }}>{preset.custom ? "我的预设" : preset.source === "skill" ? "技能" : "预设"}</span>
                                    </span>
                                    <span className="mt-0.5 block truncate text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{preset.description}</span>
                                </span>
                            </button>
                            {preset.custom ? (
                                <div className="mr-1 flex shrink-0 items-center gap-0.5">
                                    <button type="button" aria-label={`重命名预设 ${preset.name}`} title="重命名预设" className="grid size-6 place-items-center rounded" style={{ color: theme.node.muted }} onClick={() => beginRename(preset)}><Pencil className="size-3.5" /></button>
                                    <button type="button" aria-label={`删除预设 ${preset.name}`} title="删除预设" className="grid size-6 place-items-center rounded" style={{ color: theme.node.muted }} onClick={() => removeCustomPreset(preset.id)}><Trash2 className="size-3.5" /></button>
                                </div>
                            ) : null}
                        </div>
                    );
                }) : (
                    <div className="py-8 text-center text-xs" style={{ color: theme.node.muted }}>没有匹配的预设</div>
                )}
            </div>
        </div>
    );

    return (
        <Popover
            open={actualOpen}
            onOpenChange={setOpen}
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={content}
            classNames={{ root: "canvas-preset-picker-popover", container: "canvas-composer-popover-surface", content: "canvas-composer-popover-content" }}
        >
            <button
                type="button"
                className={`canvas-preset-picker-trigger ${appearance === "quiet" ? "canvas-node-composer-header-action" : ""} inline-flex shrink-0 items-center justify-center gap-1 rounded-lg transition focus-visible:outline-none ${compact ? "size-6" : dense ? "h-6 px-1.5" : "h-7 px-2"}`}
                style={appearance === "quiet" ? undefined : { background: theme.accent.primarySoft, color: theme.accent.primary }}
                title={appearance === "quiet" ? "预设" : "打开提示词预设"}
                aria-label={appearance === "quiet" ? "预设" : "打开提示词预设"}
                aria-expanded={actualOpen}
            >
                {appearance === "quiet" ? <LayoutTemplate className="size-3" /> : <WandSparkles className={dense ? "size-3" : "size-3.5"} />}
                {compact ? null : <span className="text-[var(--fs-tiny)] font-medium">预设</span>}
            </button>
        </Popover>
    );
}
