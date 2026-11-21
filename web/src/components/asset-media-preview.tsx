import { useEffect, useRef, useState, type ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { useResourceVideoPlayback } from "@/hooks/use-resource-video-playback";
import type { Asset } from "@/stores/use-asset-store";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
    hoverPlayDelayMs?: number;
};

export function AssetMediaPreview({ asset, alt, className = "", fallback = null, hoverPlayDelayMs }: AssetMediaPreviewProps) {
    const hoverTimerRef = useRef<number | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [mediaFailed, setMediaFailed] = useState(false);
    const [hoverActive, setHoverActive] = useState(false);
    const videoStorageKey = asset?.kind === "video" ? asset.data.storageKey : undefined;
    const videoFallbackUrl = asset?.kind === "video" ? asset.data.url : "";
    const videoPoster = asset?.kind === "video" && asset.coverUrl && asset.coverUrl !== asset.data.url ? asset.coverUrl : "";
    const loadVideo = asset?.kind === "video" && (!videoPoster || hoverActive || hoverPlayDelayMs === undefined);
    const playback = useResourceVideoPlayback(videoStorageKey || "", videoFallbackUrl || "", loadVideo);
    const resolvedVideoUrl = playback.url;
    useEffect(() => {
        setMediaFailed(false);
        setHoverActive(false);
    }, [asset?.id]);
    useEffect(() => () => { if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current); }, []);
    useEffect(() => {
        if (!hoverActive || hoverPlayDelayMs === undefined || !resolvedVideoUrl) return;
        hoverTimerRef.current = window.setTimeout(() => {
            void videoRef.current?.play().catch(() => undefined);
        }, hoverPlayDelayMs);
        return () => {
            if (hoverTimerRef.current !== null) {
                window.clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
            }
        };
    }, [hoverActive, hoverPlayDelayMs, resolvedVideoUrl]);
    if (!asset) return fallback;
    if (!videoPoster && (mediaFailed || playback.error)) return fallback;

    if (asset.kind === "video" && asset.data.url) {
        const clearHoverTimer = () => {
            if (hoverTimerRef.current !== null) {
                window.clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
            }
        };
        const poster = videoPoster || undefined;
        if (poster && hoverPlayDelayMs !== undefined && (!hoverActive || !resolvedVideoUrl)) {
            return (
                <CachedResourceImage
                    src={poster}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    className={className}
                    fallback={fallback}
                    onMouseEnter={hoverPlayDelayMs === undefined ? undefined : () => setHoverActive(true)}
                    onMouseLeave={hoverPlayDelayMs === undefined ? undefined : () => {
                        setHoverActive(false);
                        clearHoverTimer();
                    }}
                />
            );
        }
        if (!resolvedVideoUrl) return fallback;
        return (
            <video
                ref={videoRef}
                src={resolvedVideoUrl}
                poster={poster}
                aria-label={alt}
                muted
                playsInline
                preload={poster ? "metadata" : "auto"}
                className={className}
                onError={() => {
                    if (!playback.requestCompatible()) {
                        setMediaFailed(true);
                        setHoverActive(false);
                    }
                }}
                onMouseEnter={() => {
                    if (hoverPlayDelayMs === undefined) return;
                    setHoverActive(true);
                    clearHoverTimer();
                }}
                onMouseLeave={(event) => {
                    if (hoverPlayDelayMs === undefined) return;
                    clearHoverTimer();
                    setHoverActive(false);
                    event.currentTarget.pause();
                    event.currentTarget.currentTime = 0;
                }}
                onLoadedMetadata={(event) => {
                    // 主动触发首帧附近的解码，避免只有 metadata 时长期停留在空白画面。
                    const video = event.currentTarget;
                    if (!poster && video.currentTime === 0 && video.duration > 0) video.currentTime = Math.min(0.001, video.duration);
                }}
                onLoadedData={(event) => {
                    const video = event.currentTarget;
                    if (!poster && video.readyState >= 2) {
                        video.currentTime = 0;
                        video.pause();
                    }
                }}
            />
        );
    }

    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (!imageUrl && !storageKey) return fallback;
    return <CachedResourceImage storageKey={storageKey} src={imageUrl} alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} />;
}
