export type MissingExportFile = {
    owner: string;
    reference: string;
};

export type MissingExportKind = "image" | "video" | "audio" | "drawing" | "model" | "other";

export type MissingExportGroup = {
    kind: MissingExportKind;
    label: string;
    count: number;
};

const missingExportLabels: Record<MissingExportKind, string> = {
    image: "图片与封面",
    video: "视频",
    audio: "音频",
    drawing: "画板",
    model: "3D 模型",
    other: "其他文件",
};

export function missingExportFileKind(file: MissingExportFile): MissingExportKind {
    const reference = file.reference.split(/[?#]/, 1)[0]?.toLowerCase() || "";
    if (reference.includes("/drawings/") || reference.endsWith(".excalidraw")) return "drawing";
    const extension = reference.match(/\.([a-z0-9]+)$/)?.[1] || "";
    if (["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(extension)) return "image";
    if (["mp4", "webm", "mov", "m4v", "avi", "mkv"].includes(extension)) return "video";
    if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(extension)) return "audio";
    if (["glb", "gltf", "obj", "fbx", "usdz"].includes(extension)) return "model";
    return "other";
}

export function summarizeMissingExportFiles(files: readonly MissingExportFile[]): MissingExportGroup[] {
    const counts = new Map<MissingExportKind, number>();
    for (const file of files) {
        const kind = missingExportFileKind(file);
        counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    return (Object.keys(missingExportLabels) as MissingExportKind[])
        .filter((kind) => counts.has(kind))
        .map((kind) => ({ kind, label: missingExportLabels[kind], count: counts.get(kind) || 0 }));
}

/** Incomplete archives cannot safely serve as a backup. Keep every missing reference. */
export class ExportIntegrityError extends Error {
    readonly missingFiles: MissingExportFile[];

    constructor(missingFiles: MissingExportFile[]) {
        const unique = uniqueMissingExportFiles(missingFiles);
        super(`导出未完成：缺少 ${unique.length} 个文件，未生成不完整的备份。请找回以下文件后重试：\n${unique.map((item) => `${item.owner}：${item.reference}`).join("\n")}`);
        this.name = "ExportIntegrityError";
        this.missingFiles = unique;
    }
}

export function uniqueMissingExportFiles(missingFiles: MissingExportFile[]): MissingExportFile[] {
    return [...new Map(missingFiles.map((item) => [JSON.stringify([item.owner, item.reference]), item])).values()]
        .sort((a, b) => a.owner.localeCompare(b.owner) || a.reference.localeCompare(b.reference));
}

export function assertUniqueArchiveNames(names: Iterable<string>): void {
    const seen = new Set<string>();
    for (const name of names) {
        if (seen.has(name)) throw new Error(`导出包存在重名文件，未保存：${name}`);
        seen.add(name);
    }
}

const ARCHIVE_EXTENSION_BY_MIME: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "audio/mp4": "mp4",
    "video/webm": "webm",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
};

export function archiveFileExtension(mimeType: string, fallback: "png" | "bin" | "wav" | "mp3"): string {
    const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    return ARCHIVE_EXTENSION_BY_MIME[mime] ?? fallback;
}
