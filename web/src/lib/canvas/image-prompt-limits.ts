const ZHENZHEN_IMAGE_MIN_PROMPT_CHARS = 5;
const ZHENZHEN_IMAGE_MAX_PROMPT_CHARS = 5000;

export function imagePromptLengthError(prompt: string, model: string): string | null {
    const normalizedModel = model
        .trim()
        .toLowerCase()
        .replace(/^models\//, "");
    if (!normalizedModel.startsWith("zhenzhen-image-")) return null;
    const length = Array.from(prompt.trim()).length;
    if (length < ZHENZHEN_IMAGE_MIN_PROMPT_CHARS) {
        return `当前图片模型的提示词至少需要 ${ZHENZHEN_IMAGE_MIN_PROMPT_CHARS} 个字符`;
    }
    if (length > ZHENZHEN_IMAGE_MAX_PROMPT_CHARS) {
        return `当前图片模型的提示词最多支持 ${ZHENZHEN_IMAGE_MAX_PROMPT_CHARS} 个字符`;
    }
    return null;
}
