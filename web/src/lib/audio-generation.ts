export const audioVoiceOptions = [
    { value: "alloy", label: "Alloy" },
    { value: "ash", label: "Ash" },
    { value: "ballad", label: "Ballad" },
    { value: "coral", label: "Coral" },
    { value: "echo", label: "Echo" },
    { value: "fable", label: "Fable" },
    { value: "nova", label: "Nova" },
    { value: "onyx", label: "Onyx" },
    { value: "sage", label: "Sage" },
    { value: "shimmer", label: "Shimmer" },
    { value: "verse", label: "Verse" },
    { value: "marin", label: "Marin" },
    { value: "cedar", label: "Cedar" },
];

export const audioFormatOptions = [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "opus", label: "Opus" },
    { value: "aac", label: "AAC" },
    { value: "flac", label: "FLAC" },
    { value: "pcm", label: "PCM" },
];

// Seed Audio（上游 doubao-seed-audio-1.0，异步 /v1/audio/generations）实测可用的音色：
// 上游只挂了豆包 uranus 家族，其余 moon/mars/mega 家族与 en_* 一律报 speaker not found。
// 「默认音色」= 不传 speaker，用上游默认音色（实测可用，且不额外计费）。
export const seedAudioVoiceOptions = [
    { value: "", label: "默认音色" },
    { value: "zh_male_shaonianzixin_uranus_bigtts", label: "少年梓辛" },
    { value: "zh_male_yangguangqingnian_uranus_bigtts", label: "阳光青年" },
    { value: "zh_male_wennuanahu_uranus_bigtts", label: "温暖阿虎" },
    { value: "zh_female_shuangkuaisisi_uranus_bigtts", label: "爽快思思" },
    { value: "zh_female_cancan_uranus_bigtts", label: "灿灿" },
    { value: "zh_female_meilinvyou_uranus_bigtts", label: "魅力女友" },
    { value: "zh_female_tianmeitaozi_uranus_bigtts", label: "甜美桃子" },
];

// Seed Audio 只接受 wav / mp3 / pcm / ogg_opus；画布的 opus 由协议层映射成 ogg_opus。
export const seedAudioFormatOptions = [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "pcm", label: "PCM" },
    { value: "opus", label: "Opus" },
];

export const seedAudioSampleRateOptions = [
    { value: "8000", label: "8 kHz" },
    { value: "16000", label: "16 kHz" },
    { value: "24000", label: "24 kHz" },
    { value: "32000", label: "32 kHz" },
    { value: "44100", label: "44.1 kHz" },
];

// MiniMax native TTS content types: mp3/wav/flac/aac/pcm. Opus is OpenAI-only;
// TokenHub will forward it, but MiniMax does not declare a content type for it.
export const minimaxAudioFormatOptions = audioFormatOptions.filter((item) => item.value !== "opus");

// BeefAPI MiniMax speech: voice is a MiniMax system/cloned ID, not OpenAI alloy.
// Documented example is male-qn-qingse; these are the T2A 系统音色.
export const minimaxSpeechVoiceOptions = [
    { value: "male-qn-qingse", label: "青涩青年" },
    { value: "male-qn-jingying", label: "精英青年" },
    { value: "male-qn-badao", label: "霸道青年" },
    { value: "male-qn-daxuesheng", label: "青年大学生" },
    { value: "female-shaonv", label: "少女" },
    { value: "female-yujie", label: "御姐" },
    { value: "female-chengshu", label: "成熟女性" },
    { value: "female-tianmei", label: "甜美女性" },
    { value: "presenter_male", label: "男主持人" },
    { value: "presenter_female", label: "女主持人" },
    { value: "audiobook_male_1", label: "男有声书 1" },
    { value: "audiobook_male_2", label: "男有声书 2" },
    { value: "audiobook_female_1", label: "女有声书 1" },
    { value: "audiobook_female_2", label: "女有声书 2" },
];

export type AudioSpeechKind = "openai" | "minimax-speech" | "minimax-music" | "doubao-seed-audio" | "mureka-music" | "suno-sfx";

export type AudioSpeechProfile = {
    kind: AudioSpeechKind;
    voices: Array<{ value: string; label: string }>;
    formats: Array<{ value: string; label: string }>;
    /** 采样率档位；空数组表示该模型不暴露采样率设置。 */
    sampleRates: Array<{ value: string; label: string }>;
    defaultVoice: string;
    defaultFormat: string;
    defaultSampleRate: string;
    speedMin: number;
    speedMax: number;
    speedOptions: string[];
    showVoice: boolean;
    showSpeed: boolean;
    showPitch: boolean;
    showVolume: boolean;
    showInstructions: boolean;
    /** 唱歌类音乐模型（如 MiniMax Music 2.6）必须提供歌词才能出人声。 */
    showLyrics?: boolean;
    showSampleRate: boolean;
};

const OPENAI_SPEECH_VOICES = new Set(audioVoiceOptions.map((item) => item.value));

export function audioModelId(model: string) {
    const trimmed = model.trim();
    const separator = trimmed.lastIndexOf("::");
    return (separator >= 0 ? trimmed.slice(separator + 2) : trimmed).toLowerCase();
}

export function isMinimaxMusicV3(model: string) {
    return audioModelId(model).startsWith("minimax-music-v3");
}

export function audioSpeechKind(model: string): AudioSpeechKind {
    const id = audioModelId(model);
    if (id.includes("minimax-speech")) return "minimax-speech";
    if (id.includes("minimax-music")) return "minimax-music";
    // 豆包 Seed Audio（上游 doubao-seed-audio-1.0）：音色是豆包音色 ID，
    // 输出格式与采样率的可选值都和 OpenAI 档不同。
    if (id.includes("doubao-seed-audio") || id.includes("seed-audio")) return "doubao-seed-audio";
    // 音乐 / BGM 档（mureka-*-bgm、mureka-*-song）：只有提示词，没有音色/采样率等语音参数。
    if (id.includes("mureka") || id.includes("-bgm") || id.includes("music")) return "mureka-music";
    // 音效档（suno-sounds）：同样只吃提示词。
    if (id.includes("suno") || id.includes("sound") || id.includes("sfx")) return "suno-sfx";
    return "openai";
}

export function audioSpeechProfile(model = ""): AudioSpeechProfile {
    const kind = audioSpeechKind(model);
    if (kind === "minimax-speech") {
        return {
            kind,
            voices: minimaxSpeechVoiceOptions,
            formats: minimaxAudioFormatOptions,
            sampleRates: [],
            defaultVoice: "male-qn-qingse",
            defaultFormat: "mp3",
            defaultSampleRate: "",
            speedMin: 0.5,
            speedMax: 2,
            speedOptions: ["0.5", "0.75", "1", "1.25", "1.5", "2"],
            showVoice: true,
            showSpeed: true,
            showPitch: false,
            showVolume: false,
            showInstructions: false,
            showSampleRate: false,
        };
    }
    if (kind === "minimax-music") {
        return {
            showLyrics: true,
            kind,
            voices: [],
            formats: audioFormatOptions.filter((item) => item.value === "mp3"),
            sampleRates: [],
            defaultVoice: "",
            defaultFormat: "mp3",
            defaultSampleRate: "",
            speedMin: 1,
            speedMax: 1,
            speedOptions: ["1"],
            showVoice: false,
            showSpeed: false,
            showPitch: false,
            showVolume: false,
            showInstructions: false,
            showSampleRate: false,
        };
    }
    // 音乐 / BGM / 音效：模型只吃提示词，界面上不该出现音色、格式、采样率这些语音参数。
    if (kind === "mureka-music" || kind === "suno-sfx") {
        return {
            kind,
            voices: [],
            formats: [],
            sampleRates: [],
            defaultVoice: "",
            defaultFormat: "",
            defaultSampleRate: "",
            speedMin: 1,
            speedMax: 1,
            speedOptions: [],
            showVoice: false,
            showSpeed: false,
            showPitch: false,
            showVolume: false,
            showInstructions: false,
            // 带唱的音乐模型（mureka-v9-song 这类）上游同样要求歌词；纯 BGM 与音效不需要。
            showLyrics: kind === "mureka-music" && model.toLowerCase().includes("song"),
            showSampleRate: false,
        };
    }
    if (kind === "doubao-seed-audio") {
        return {
            kind,
            voices: seedAudioVoiceOptions,
            formats: seedAudioFormatOptions,
            sampleRates: seedAudioSampleRateOptions,
            defaultVoice: "",
            defaultFormat: "mp3",
            defaultSampleRate: "24000",
            speedMin: 0.5,
            speedMax: 2,
            speedOptions: ["0.5", "0.75", "1", "1.25", "1.5", "2"],
            showVoice: true,
            showSpeed: true,
            showPitch: false,
            showVolume: false,
            showInstructions: false,
            showSampleRate: true,
        };
    }
    return {
        kind,
        voices: audioVoiceOptions,
        formats: audioFormatOptions,
        sampleRates: [],
        defaultVoice: "alloy",
        defaultFormat: "mp3",
        defaultSampleRate: "",
        speedMin: 0.25,
        speedMax: 4,
        speedOptions: ["0.75", "1", "1.25", "1.5"],
        showVoice: true,
        showSpeed: true,
        showPitch: false,
        showVolume: false,
        showInstructions: true,
        showSampleRate: false,
    };
}

export function normalizeAudioVoiceValue(value: string, model?: string) {
    const profile = audioSpeechProfile(model);
    if (!profile.showVoice) return "";
    const trimmed = String(value || "").trim();
    if (profile.voices.some((item) => item.value === trimmed)) return trimmed;
    if (profile.kind === "doubao-seed-audio") {
        // 空值 = 上游默认音色；只接受实测可用的豆包音色 ID。
        return profile.defaultVoice;
    }
    if (profile.kind === "minimax-speech") {
        if (!trimmed || OPENAI_SPEECH_VOICES.has(trimmed) || trimmed === "中文") return profile.defaultVoice;
        return trimmed;
    }
    return OPENAI_SPEECH_VOICES.has(trimmed) ? trimmed : profile.defaultVoice;
}

export function normalizeAudioSampleRateValue(value: string, model?: string) {
    const profile = audioSpeechProfile(model);
    if (!profile.showSampleRate) return "";
    const trimmed = String(value || "").trim();
    return profile.sampleRates.some((item) => item.value === trimmed) ? trimmed : profile.defaultSampleRate;
}

export function audioSampleRateLabel(value: string, model?: string) {
    const profile = audioSpeechProfile(model);
    const rate = normalizeAudioSampleRateValue(value, model);
    if (!rate) return "";
    return profile.sampleRates.find((item) => item.value === rate)?.label || `${Number(rate) / 1000} kHz`;
}

export function normalizeAudioFormatValue(value: string, model?: string) {
    const profile = audioSpeechProfile(model);
    const trimmed = String(value || "")
        .trim()
        .toLowerCase();
    return profile.formats.some((item) => item.value === trimmed) ? trimmed : profile.defaultFormat;
}

export function normalizeAudioSpeedValue(value: string, model?: string) {
    const profile = audioSpeechProfile(model);
    if (!String(value ?? "").trim()) return "1";
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed <= 0) return "1";
    return String(Math.max(profile.speedMin, Math.min(profile.speedMax, Number(speed.toFixed(2)))));
}

export function normalizeAudioPitchValue(value: string) {
    const pitch = Number(value);
    if (!Number.isFinite(pitch)) return "0";
    return String(Math.max(-12, Math.min(12, Number(pitch.toFixed(2)))));
}

export function normalizeAudioVolumeValue(value: string) {
    const volume = Number(value);
    if (!Number.isFinite(volume)) return "1";
    return String(Math.max(0, Math.min(1, Number(volume.toFixed(2)))));
}

export function audioVoiceLabel(value: string, model?: string) {
    const profile = audioSpeechProfile(model);
    const voice = normalizeAudioVoiceValue(value, model);
    return profile.voices.find((item) => item.value === voice)?.label || voice;
}

export function audioFormatLabel(value: string, model?: string) {
    const format = normalizeAudioFormatValue(value, model);
    const profile = audioSpeechProfile(model);
    return profile.formats.find((item) => item.value === format)?.label || format;
}

export function audioSpeedLabel(value: string, model?: string) {
    return `${normalizeAudioSpeedValue(value, model)}x`;
}

export function audioPitchLabel(value: string) {
    const pitch = normalizeAudioPitchValue(value);
    return `${Number(pitch) > 0 ? "+" : ""}${pitch}`;
}

export function audioVolumeLabel(value: string) {
    return `${Math.round(Number(normalizeAudioVolumeValue(value)) * 100)}%`;
}

export function resolveAudioSpeechSettings(
    model: string,
    values: {
        audioVoice?: string;
        audioFormat?: string;
        audioSpeed?: string;
        audioPitch?: string;
        audioVolume?: string;
        audioInstructions?: string;
        audioSampleRate?: string;
        audioLyrics?: string;
    },
) {
    const profile = audioSpeechProfile(model);
    return {
        audioVoice: normalizeAudioVoiceValue(values.audioVoice || "", model),
        audioFormat: normalizeAudioFormatValue(values.audioFormat || "", model),
        audioSampleRate: normalizeAudioSampleRateValue(values.audioSampleRate || "", model),
        audioSpeed: normalizeAudioSpeedValue(values.audioSpeed || "", model),
        audioPitch: profile.showPitch ? normalizeAudioPitchValue(values.audioPitch || "") : "0",
        audioVolume: profile.showVolume ? normalizeAudioVolumeValue(values.audioVolume || "") : "1",
        audioInstructions: profile.showInstructions ? String(values.audioInstructions || "") : "",
        audioLyrics: profile.showLyrics ? String(values.audioLyrics || "").trim() : "",
    };
}

export function audioSettingsSummary(config: { model?: string; audioVoice?: string; audioFormat?: string; audioSpeed?: string; audioPitch?: string; audioVolume?: string; audioSampleRate?: string }) {
    const model = config.model || "";
    const profile = audioSpeechProfile(model);
    const parts: string[] = [];
    if (profile.showVoice) parts.push(audioVoiceLabel(config.audioVoice || "", model));
    if (profile.formats.length) parts.push(audioFormatLabel(config.audioFormat || "", model));
    if (isMinimaxMusicV3(model)) parts.push("256 kbps");
    if (profile.showSampleRate) parts.push(audioSampleRateLabel(config.audioSampleRate || "", model));
    if (profile.showSpeed) parts.push(audioSpeedLabel(config.audioSpeed || "", model));
    if (profile.showPitch) parts.push(`音调${audioPitchLabel(config.audioPitch || "")}`);
    if (profile.showVolume) parts.push(`音量${audioVolumeLabel(config.audioVolume || "")}`);
    return parts.join(" · ");
}

export function buildAudioSpeechRequest(
    config: {
        model: string;
        audioVoice?: string;
        audioFormat?: string;
        audioSpeed?: string;
        audioInstructions?: string;
    },
    prompt: string,
) {
    const model = config.model.trim();
    const profile = audioSpeechProfile(model);
    const settings = resolveAudioSpeechSettings(model, config);
    const payload: Record<string, unknown> = {
        model,
        input: prompt,
        response_format: settings.audioFormat,
    };
    if (profile.showSampleRate && settings.audioSampleRate) payload.sample_rate = Number(settings.audioSampleRate);
    if (profile.showVoice) payload.voice = settings.audioVoice;
    if (profile.showSpeed) payload.speed = Number(settings.audioSpeed);
    if (isMinimaxMusicV3(model)) {
        payload.metadata = { audio_setting: { sample_rate: 44100, bitrate: 256000, format: "mp3" } };
    }
    const instructions = settings.audioInstructions.trim();
    if (profile.showInstructions && instructions) payload.instructions = instructions;
    return payload;
}

export function audioMimeType(format: string) {
    if (format === "wav") return "audio/wav";
    if (format === "opus") return "audio/opus";
    if (format === "aac") return "audio/aac";
    if (format === "flac") return "audio/flac";
    if (format === "pcm") return "audio/pcm";
    return "audio/mpeg";
}
