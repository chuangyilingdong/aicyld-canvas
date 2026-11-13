import { videoDurationOptions, type VideoCapabilityConfig } from "@/lib/model-capabilities";

export const SMART_FILM_DEFAULT_SHOT_SECONDS = 5;
export const SMART_FILM_FALLBACK_MAX_CLIP_SECONDS = 10;

export function smartFilmDurationOptions(profile?: VideoCapabilityConfig) {
    const values = profile ? videoDurationOptions(profile).filter((value) => Number.isFinite(value) && value > 0) : [];
    const unique = [...new Set(values.map((value) => Math.round(value * 10) / 10))].sort((left, right) => left - right);
    return unique.length ? unique : [5, 10];
}

export function smartFilmMaxClipSeconds(profile?: VideoCapabilityConfig) {
    const options = smartFilmDurationOptions(profile);
    return options[options.length - 1] || SMART_FILM_FALLBACK_MAX_CLIP_SECONDS;
}

export function smartFilmDefaultShotSeconds(profile?: VideoCapabilityConfig) {
    const options = smartFilmDurationOptions(profile);
    const configured = Number(profile?.duration.default);
    if (options.includes(configured)) return configured;
    return options.includes(SMART_FILM_DEFAULT_SHOT_SECONDS) ? SMART_FILM_DEFAULT_SHOT_SECONDS : options[0];
}

export function normalizeSmartFilmShotSeconds(value: unknown, profile?: VideoCapabilityConfig) {
    const options = smartFilmDurationOptions(profile);
    const numeric = Number(value);
    if (options.includes(numeric)) return numeric;
    const fallback = smartFilmDefaultShotSeconds(profile);
    if (!Number.isFinite(numeric)) return fallback;
    return options.reduce((closest, option) => (Math.abs(option - numeric) < Math.abs(closest - numeric) ? option : closest), options[0]);
}

export function resizeSmartFilmShotDurations(previous: number[], count: number, profile?: VideoCapabilityConfig) {
    const size = Math.max(1, Math.min(20, Math.round(Number(count) || 1)));
    const fallback = smartFilmDefaultShotSeconds(profile);
    return Array.from({ length: size }, (_, index) => normalizeSmartFilmShotSeconds(previous[index] ?? fallback, profile));
}
