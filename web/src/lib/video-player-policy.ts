export type VideoPlayerMimeType =
    | "video/mp4"
    | "video/webm"
    | "video/3gp"
    | "video/ogg"
    | "video/avi"
    | "video/mpeg"
    | "video/object";

const SUPPORTED_VIDEO_PLAYER_MIME_TYPES = new Set<VideoPlayerMimeType>([
    "video/mp4",
    "video/webm",
    "video/3gp",
    "video/ogg",
    "video/avi",
    "video/mpeg",
    "video/object",
]);

export function normalizeVideoPlayerMimeType(mimeType?: string): VideoPlayerMimeType {
    const container = mimeType?.split(";", 1)[0]?.trim().toLowerCase() as VideoPlayerMimeType | undefined;
    return container && SUPPORTED_VIDEO_PLAYER_MIME_TYPES.has(container) ? container : "video/mp4";
}

export function resolveEffectiveVideoHasAudio(
    hasAudio: boolean | undefined,
    detectedHasAudio: boolean | undefined,
): boolean | undefined {
    return detectedHasAudio === false
        ? false
        : hasAudio === true || detectedHasAudio === true
          ? true
          : hasAudio === false
            ? false
            : undefined;
}
