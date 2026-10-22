import { ImageSizePicker } from "./image-size-picker";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { type ReactNode } from "react";
import { ConfigProvider, Input, InputNumber, Select } from "antd";
import { Switch } from "@/components/ui/base/switch";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { buildImageResolutionOptions, formatImageResolutionSize } from "@/lib/image-resolution-tiers";
import { modelCapabilityConfigFor, normalizeImageValue, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import { type AiConfig } from "@/stores/use-config-store";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
    { value: "relax", label: "放松" },
    { value: "fast", label: "快速" },
    { value: "turbo", label: "极速" },
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
    onConfigChange: (key: "quality" | "size" | "transparentBackground" | "count", value: string) => void;
    midjourneyParameters?: Record<string, unknown>;
    onMidjourneyParameterChange?: (key: string, value: string | number | boolean | undefined) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    showQuality?: boolean;
    showTransparent?: boolean;
    showSize?: boolean;
    showCount?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, midjourneyParameters, onMidjourneyParameterChange, theme, showTitle = true, showQuality = true, showTransparent = true, showSize = true, showCount = true, className = "w-[304px] space-y-3 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 3 }: ImageSettingsPanelProps) {
    const profile = mergedImageCapabilityConfig(config, config.model || config.imageModel);
    const normalized = normalizeImageValue(profile, config);
    const quality = normalized.quality;
    const transparentBackground = normalized.transparentBackground === "true";
    const effectiveMaxCount = Math.min(maxCount, profile.maxOutputs);
    const count = Math.max(1, Math.min(effectiveMaxCount, Number(normalized.count)));
    const activeSize = normalized.size;
    const activeQualityOptions = profile.quality.values.map((value) => qualityOptions.find((item) => item.value === value) || { value, label: value });
    const isMidjourney = isMidjourneySpeedQuality(profile);
    const midjourneyQuality = typeof midjourneyParameters?.quality === "string" ? midjourneyParameters.quality : "";

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
                    <SettingTitle color={theme.node.muted}>{isMidjourneySpeedQuality(profile) ? "生成速度" : isGrokResolutionQuality(profile) ? "分辨率" : "质量"}</SettingTitle>
                    <div className={`grid gap-1.5 ${activeQualityOptions.length <= 2 ? "grid-cols-2" : "grid-cols-4"}`}>
						{activeQualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div> : null}
                {showQuality && isMidjourney && onMidjourneyParameterChange ? <div className="space-y-2">
                    <SettingTitle color={theme.node.muted}>细节质量（--q）</SettingTitle>
                    <div className="grid grid-cols-5 gap-1.5">
                        {["default", "0.25", "0.5", "1", "2"].map((value) => (
                            <OptionPill key={value} selected={(midjourneyQuality || "default") === value} theme={theme} onClick={() => onMidjourneyParameterChange("quality", value === "default" ? undefined : value)}>
                                {value === "default" ? "默认" : value}
                            </OptionPill>
                        ))}
                    </div>
                    <MidjourneyAdvancedPanel theme={theme} parameters={midjourneyParameters || {}} onChange={onMidjourneyParameterChange} />
                </div> : null}
                {showTransparent && profile.transparentBackground.supported ? <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                        <div className="mt-1 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            请求模型输出保留 Alpha 通道的 PNG
                        </div>
                    </div>
                    <span title="是否支持透明背景由当前模型接口决定" onMouseDown={(event) => event.stopPropagation()}>
                        <Switch
                            size="sm"
                            checked={transparentBackground}
                            onChange={(checked) => onConfigChange("transparentBackground", checked ? "true" : "false")}
                        />
                    </span>
                </div> : null}
                {showSize ? <ImageSizePicker profile={profile} size={activeSize} quality={quality} onChange={(size, nextQuality) => applyImageSizeSelection(onConfigChange, size, nextQuality)} /> : null}
                {showCount && effectiveMaxCount > 1 ? (
                    <div className="space-y-2">
                        <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
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

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", high: "高", medium: "中", low: "低", relax: "放松", fast: "快速", turbo: "极速", "1k": "1K", "2k": "2K", "4k": "4K" } as Record<string, string>)[value.toLowerCase()] || value || "默认";
}

function isGrokResolutionQuality(profile: ImageCapabilityConfig) {
    const values = profile.quality.values.map((item) => item.toLowerCase());
    return values.some((value) => ["1k", "2k", "4k"].includes(value));
}

function isMidjourneySpeedQuality(profile: ImageCapabilityConfig) {
    const values = profile.quality.values.map((item) => item.toLowerCase());
    return values.some((value) => ["relax", "fast", "turbo"].includes(value));
}

export function imageSizeLabel(size: string) {
    const resolutionLabel = formatImageResolutionSize(size, buildImageResolutionOptions([size]));
    return resolutionLabel !== size ? resolutionLabel : aspectOptions.find((item) => (item.size || item.value) === size || item.value === size)?.label || size;
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
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

function MidjourneyAdvancedPanel({
    theme,
    parameters,
    onChange,
}: {
    theme: CanvasTheme;
    parameters: Record<string, unknown>;
    onChange: (key: string, value: string | number | boolean | undefined) => void;
}) {
    const version = typeof parameters.version === "string" ? parameters.version : "";
    const stringValue = (key: string) => typeof parameters[key] === "string" ? parameters[key] as string : "";
    const numberValue = (key: string) => typeof parameters[key] === "number" ? parameters[key] as number : undefined;
    const booleanValue = (key: string) => parameters[key] === true;
    const numberChange = (key: string) => (value: number | null) => onChange(key, value ?? undefined);
    const stringChange = (key: string) => (value: string) => onChange(key, value.trim() || undefined);
    return (
        <details className="rounded-xl border px-2.5 py-2" style={{ borderColor: theme.node.stroke }}>
            <summary className="cursor-pointer select-none text-xs font-medium" style={{ color: theme.node.muted }}>高级参数</summary>
            <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                    <SmallField label="风格">
                        <Select value={stringValue("style") || "default"} onChange={(value) => onChange("style", value === "default" ? undefined : value)} options={[{ value: "default", label: "默认" }, { value: "raw", label: "Raw" }]} />
                    </SmallField>
                    <SmallField label="种子">
                        <InputNumber className="w-full" min={0} precision={0} value={numberValue("seed")} onChange={numberChange("seed")} placeholder="默认" />
                    </SmallField>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <SmallField label="风格化"><InputNumber className="w-full" min={0} max={1000} value={numberValue("stylize")} onChange={numberChange("stylize")} placeholder="0–1000" /></SmallField>
                    <SmallField label="混乱"><InputNumber className="w-full" min={0} max={100} value={numberValue("chaos")} onChange={numberChange("chaos")} placeholder="0–100" /></SmallField>
                    <SmallField label="怪异"><InputNumber className="w-full" min={0} max={3000} value={numberValue("weird")} onChange={numberChange("weird")} placeholder="0–3000" /></SmallField>
                </div>
                <SmallField label="负面提示词"><Input value={stringValue("negativePrompt")} onChange={(event) => stringChange("negativePrompt")(event.target.value)} placeholder="ugly, blurry" /></SmallField>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {version === "7" ? <ToggleField label="Niji" checked={booleanValue("niji")} theme={theme} onChange={(checked) => onChange("niji", checked)} /> : null}
                    <ToggleField label="Tiled" checked={booleanValue("tile")} theme={theme} onChange={(checked) => onChange("tile", checked)} />
                    <ToggleField label="Draft" checked={booleanValue("draft")} theme={theme} onChange={(checked) => onChange("draft", checked)} />
                    {(version === "8.1" || version === "8.2") ? <ToggleField label="HD" checked={booleanValue("hd")} theme={theme} onChange={(checked) => onChange("hd", checked)} /> : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <SmallField label="图片权重"><InputNumber className="w-full" min={0} max={3} step={0.1} value={numberValue("iw")} onChange={numberChange("iw")} placeholder="0–3" /></SmallField>
                    <SmallField label="角色权重"><InputNumber className="w-full" min={0} max={100} value={numberValue("cw")} onChange={numberChange("cw")} placeholder="0–100" /></SmallField>
                    <SmallField label="风格权重"><InputNumber className="w-full" min={0} max={1000} value={numberValue("sw")} onChange={numberChange("sw")} placeholder="0–1000" /></SmallField>
                    <SmallField label="深度权重"><InputNumber className="w-full" min={0} max={100} value={numberValue("dw")} onChange={numberChange("dw")} placeholder="0–100" /></SmallField>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <SmallField label="角色参考"><Input value={stringValue("cref")} onChange={(event) => stringChange("cref")(event.target.value)} placeholder="URL" /></SmallField>
                    <SmallField label="风格参考"><Input value={stringValue("sref")} onChange={(event) => stringChange("sref")(event.target.value)} placeholder="URL" /></SmallField>
                    <SmallField label="深度参考"><Input value={stringValue("dref")} onChange={(event) => stringChange("dref")(event.target.value)} placeholder="URL" /></SmallField>
                </div>
                <SmallField label="额外参数"><Input value={stringValue("extra")} onChange={(event) => stringChange("extra")(event.target.value)} placeholder="--xxx" /></SmallField>
            </div>
        </details>
    );
}

function SmallField({ label, children }: { label: string; children: ReactNode }) {
    return <label className="block space-y-1"><span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{label}</span>{children}</label>;
}

function ToggleField({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return <label className="inline-flex items-center gap-2 text-xs" style={{ color: theme.node.text }}><Switch size="sm" checked={checked} onChange={onChange} />{label}</label>;
}
