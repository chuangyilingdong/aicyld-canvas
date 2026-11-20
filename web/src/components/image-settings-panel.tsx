import { ImageSizePicker } from "./image-size-picker";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { type ReactNode } from "react";
import { ConfigProvider } from "antd";
import { Switch } from "@/components/ui/base/switch";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { buildImageResolutionOptions, formatImageResolutionSize } from "@/lib/image-resolution-tiers";
import { modelCapabilityConfigFor, normalizeImageValue, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import { type AiConfig } from "@/stores/use-config-store";
import { seedreamFamily } from "@/lib/seedream-image";
import { parseImageAdvancedValues } from "@/lib/image-advanced-parameters";
import { SeedreamSettings } from "./seedream-settings";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "xhigh", label: "超高" },
    { value: "max", label: "最高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
    { value: "1k", label: "1K" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
];

type AspectOption = { value: string; label: string; width: number; height: number; icon: string; size?: string };

const aspectOptions: AspectOption[] = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "2:1", label: "2:1", size: "2048x1024", width: 2048, height: 1024, icon: "landscape" },
    { value: "1:2", label: "1:2", size: "1024x2048", width: 1024, height: 2048, icon: "portrait" },
    { value: "21:9", label: "21:9", size: "2352x1008", width: 2352, height: 1008, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "1:1-2k", label: "1:1(2k)", size: "2048x2048", width: 2048, height: 2048, icon: "square" },
    { value: "16:9-2k", label: "16:9(2k)", size: "2048x1152", width: 2048, height: 1152, icon: "landscape" },
    { value: "9:16-2k", label: "9:16(2k)", size: "1152x2048", width: 1152, height: 2048, icon: "portrait" },
    { value: "16:9-4k", label: "16:9(4k)", size: "3840x2160", width: 3840, height: 2160, icon: "landscape" },
    { value: "9:16-4k", label: "9:16(4k)", size: "2160x3840", width: 2160, height: 3840, icon: "portrait" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "transparentBackground" | "imageOutputFormat" | "imageAdvancedJson" | "count" | "seedreamMode" | "seedreamMaxImages" | "seedreamOutputFormat" | "seedreamOptimize" | "seedreamWatermark", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    showQuality?: boolean;
    showTransparent?: boolean;
    showFormat?: boolean;
    showSize?: boolean;
    showCount?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, showQuality = true, showTransparent = true, showFormat = true, showSize = true, showCount = true, className = "w-[304px] space-y-3 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 3 }: ImageSettingsPanelProps) {
    const profile = mergedImageCapabilityConfig(config, config.model || config.imageModel);
    const seedream = seedreamFamily(config.model || config.imageModel);
    const model = config.model || config.imageModel;
    const normalized = normalizeImageValue(profile, config);
    const quality = normalized.quality;
    const transparentBackground = normalized.transparentBackground === "true";
    const outputFormats = profile.outputFormat.supported ? profile.outputFormat.values || [] : [];
    const outputFormat = normalized.imageOutputFormat;
    const batchCounts = profile.generationOutputs?.filter((value) => value <= maxCount);
    const effectiveMaxCount = Math.min(maxCount, batchCounts?.length ? Math.max(...batchCounts) : profile.maxOutputs);
    const count = Math.max(1, Math.min(effectiveMaxCount, Number(normalized.count)));
    const activeSize = normalized.size;
    const activeQualityOptions = profile.quality.values.map((value) => qualityOptions.find((item) => item.value === value) || { value, label: imageQualityLabel(value, model) });
    const advancedOptions = profile.advanced?.options || [];
    const advancedValues = parseImageAdvancedValues(config.imageAdvancedJson);
    const updateAdvanced = (key: string, value: string) => {
        const next = { ...advancedValues };
        if (value.trim()) next[key] = value;
        else delete next[key];
        onConfigChange("imageAdvancedJson", JSON.stringify(next));
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-base font-semibold">图像设置</div> : null}
                {showQuality && profile.quality.supported && !imageResolutionUsesQuality(profile) ? <div className="space-y-2">
                    <SettingTitle color={theme.node.muted}>{isGrokResolutionQuality(profile) ? "分辨率" : "质量"}</SettingTitle>
                    <div className={`grid gap-1.5 ${activeQualityOptions.length <= 2 ? "grid-cols-2" : "grid-cols-4"}`}>
						{activeQualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div> : null}
                {showTransparent && profile.transparentBackground.supported && (!seedream || config.seedreamMode !== "layers") ? <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                    </div>
                    <span title="是否支持透明背景由当前模型接口决定" onMouseDown={(event) => event.stopPropagation()}>
                        <Switch
                            size="sm"
                            checked={transparentBackground}
                            onChange={(checked) => { onConfigChange("transparentBackground", checked ? "true" : "false"); if (checked && seedream) onConfigChange("seedreamOutputFormat", "png"); }}
                        />
                    </span>
                </div> : null}
                {!seedream && showFormat && outputFormats.length > 1 ? (
                    <div className="space-y-2">
                        <SettingTitle color={theme.node.muted}>输出格式</SettingTitle>
                        <div className="grid grid-cols-4 gap-1.5">
                            {outputFormats.map((format) => (
                                <OptionPill key={format} selected={outputFormat === format} theme={theme} onClick={() => onConfigChange("imageOutputFormat", format)}>
                                    {imageOutputFormatLabel(format)}
                                </OptionPill>
                            ))}
                        </div>
                    </div>
                ) : null}
                {seedream ? <SeedreamSettings config={config} family={seedream} profile={profile} onChange={onConfigChange} theme={theme} /> : showSize ? <ImageSizePicker profile={profile} size={activeSize} quality={quality} onChange={(size, nextQuality) => applyImageSizeSelection(onConfigChange, size, nextQuality)} /> : null}
                {advancedOptions.length ? (
                    <details className="rounded-lg border px-2.5 py-2 text-xs" style={{ borderColor: theme.node.stroke }}>
                        <summary className="cursor-pointer font-medium">高级参数</summary>
                        <div className="mt-2 space-y-2">
                            {advancedOptions.map((option) => {
                                const value = advancedValues[option.key] ?? option.default ?? "";
                                return (
                                    <label key={option.key} className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-2">
                                        <span className="min-w-0 truncate" title={option.label}>{option.label}</span>
                                        {option.type === "number" ? (
                                            <input
                                                aria-label={option.label}
                                                type="number"
                                                min={option.min}
                                                max={option.max}
                                                step={option.step}
                                                className="h-8 min-w-0 rounded-lg border px-2"
                                                style={{ background: theme.canvas.background, color: theme.node.text, borderColor: theme.node.stroke }}
                                                value={value}
                                                placeholder="默认"
                                                onChange={(event) => updateAdvanced(option.key, event.target.value)}
                                            />
                                        ) : (
                                            <select
                                                aria-label={option.label}
                                                className="h-8 min-w-0 rounded-lg border px-2"
                                                style={{ background: theme.canvas.background, color: theme.node.text, borderColor: theme.node.stroke }}
                                                value={value}
                                                onChange={(event) => updateAdvanced(option.key, event.target.value)}
                                            >
                                                <option value="">默认</option>
                                                {(option.type === "boolean" ? ["false", "true"] : option.values || []).map((item) => (
                                                    <option key={item} value={item}>{advancedOptionLabel(item)}</option>
                                                ))}
                                            </select>
                                        )}
                                    </label>
                                );
                            })}
                        </div>
                    </details>
                ) : null}
                {!seedream && profile.sequentialGeneration?.supported ? (
                    <label className="block space-y-1.5 text-xs">
                        <span>关联组图上限</span>
                        <input
                            aria-label="关联组图上限"
                            type="number"
                            min={1}
                            max={15}
                            className="h-8 w-full rounded-lg border px-2"
                            style={{ background: theme.canvas.background, color: theme.node.text, borderColor: theme.node.stroke }}
                            value={config.seedreamMaxImages || "1"}
                            onChange={(event) => onConfigChange("seedreamMaxImages", event.target.value)}
                        />
                    </label>
                ) : null}
                {showCount && profile.fixedOutputs ? (
                    <div className="space-y-2">
                        <SettingTitle color={theme.node.muted}>{seedream ? "生成批次" : "生成张数"}</SettingTitle>
                        <div className="grid grid-cols-3 gap-1.5">
                            {(batchCounts?.length ? batchCounts : [profile.fixedOutputs]).map((value) => <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>{value}</OptionPill>)}
                        </div>
                    </div>
                ) : showCount && effectiveMaxCount > 1 ? (
                    <div className="space-y-2">
                        <SettingTitle color={theme.node.muted}>{seedream ? "生成批次" : "生成张数"}</SettingTitle>
                        <div className="grid grid-cols-4 gap-1.5">
                            {Array.from({ length: Math.min(quickCount, effectiveMaxCount) }, (_, index) => index + 1).map((value) => (
                                <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                    {value}
                                </OptionPill>
                            ))}
                            <CountInput value={count} quickCount={quickCount} max={effectiveMaxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                        </div>
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function advancedOptionLabel(value: string) {
    return ({
        minimal: "最低",
        medium: "中",
        high: "高",
        low: "低",
        auto: "自动",
        none: "关闭",
        xhigh: "超高",
        max: "最高",
        true: "开启",
        false: "关闭",
    } as Record<string, string>)[value] || value;
}

export function applyImageSizeSelection(onConfigChange: ImageSettingsPanelProps["onConfigChange"], size: string, quality?: string) {
    onConfigChange("size", size);
    if (quality) onConfigChange("quality", quality);
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.canvas.background, colorBgElevated: theme.canvas.background, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.canvas.background, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string, model?: string) {
    const normalized = value.trim().toLowerCase();
    if (isYouchuanImageModel(model)) {
        if (normalized === "1") return "标准";
        if (normalized === "2") return "增强";
        if (normalized === "3") return "高细节";
        if (normalized === "4") return model?.toLowerCase().includes("v8.1") ? "高细节" : "实验";
    }
    return ({ auto: "自动", high: "高", xhigh: "超高", max: "最高", medium: "中", low: "低", "1k": "1K", "2k": "2K", "4k": "4K" } as Record<string, string>)[normalized] || value || "默认";
}

function isYouchuanImageModel(model?: string) {
    const normalized = String(model || "").toLowerCase();
    return normalized.includes("youchuan") || normalized.includes("midjourney-v8");
}

export function imageOutputFormatLabel(value: string) {
    return ({ png: "PNG", jpeg: "JPEG", jpg: "JPEG", webp: "WebP", gif: "GIF", svg: "SVG" } as Record<string, string>)[value.toLowerCase()] || value.toUpperCase();
}

function isGrokResolutionQuality(profile: ImageCapabilityConfig) {
    const values = profile.quality.values.map((item) => item.toLowerCase());
    return values.some((value) => ["1k", "2k", "4k"].includes(value));
}

export function imageSizeLabel(size: string, profile?: ImageCapabilityConfig) {
    const resolutionLabel = formatImageResolutionSize(size, profile?.size.presets || buildImageResolutionOptions([size]));
    return resolutionLabel !== size ? resolutionLabel : aspectOptions.find((item) => (item.size || item.value) === size || item.value === size)?.label || size;
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            aria-pressed={selected}
            type="button"
			className="h-8 cursor-pointer rounded-full px-2 text-xs transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
			style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: theme.node.text, outlineColor: theme.node.muted }}
			disabled={disabled}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function CountInput({ value, quickCount, max, theme, onChange }: { value: number; quickCount: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Math.max(1, Math.min(max, Math.floor(Number(input.value) || 1)));
        input.value = String(next);
        onChange(next);
    };
    return (
        <label className="flex h-8 overflow-hidden rounded-full text-xs" style={{ background: theme.toolbar.itemHover, color: theme.node.text }}>
            <input
                key={value > quickCount ? `custom-${value}` : "quick"}
                type="number"
                min={1}
                max={max}
                aria-label="自定义生成张数"
                placeholder="输入"
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none placeholder:text-current placeholder:opacity-55 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                defaultValue={value > quickCount ? value : ""}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}
