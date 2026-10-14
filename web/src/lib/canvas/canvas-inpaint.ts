export type CanvasInpaintRegion = {
    x: number;
    y: number;
    width: number;
    height: number;
};

/**
 * 局部重绘的无蒙版实现（上游图片接口没有 mask 参数）：
 * 涂抹蒙版（白色=保留，透明=重绘）→ 解析出要重绘的区域框 → 裁切该区域 + 提示词做图改图
 * → 把生成结果按羽化蒙版融回源图。模型只负责区域重绘，最终结果始终以源图为底。
 */

const maskRedrawAlphaThreshold = 128;

export async function canvasInpaintRegionFromMask(
    maskDataUrl: string,
    imageWidth: number,
    imageHeight: number,
    paddingRatio = 0.18,
): Promise<CanvasInpaintRegion | null> {
    const mask = await loadImageBitmap(maskDataUrl);
    try {
        const width = mask.width || imageWidth;
        const height = mask.height || imageHeight;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("浏览器无法读取局部重绘蒙版");
        context.drawImage(mask, 0, 0);
        const pixels = context.getImageData(0, 0, width, height).data;
        let left = width;
        let top = height;
        let right = -1;
        let bottom = -1;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (pixels[(y * width + x) * 4 + 3] >= maskRedrawAlphaThreshold) continue;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
        if (right < left || bottom < top) return null;
        const paintedWidth = right - left + 1;
        const paintedHeight = bottom - top + 1;
        const padding = Math.round(Math.max(paintedWidth, paintedHeight) * Math.max(0, paddingRatio));
        const padded = {
            x: Math.max(0, left - padding),
            y: Math.max(0, top - padding),
            width: Math.min(width, right + 1 + padding) - Math.max(0, left - padding),
            height: Math.min(height, bottom + 1 + padding) - Math.max(0, top - padding),
        };
        return {
            x: padded.x,
            y: padded.y,
            width: Math.max(1, Math.min(width - padded.x, padded.width)),
            height: Math.max(1, Math.min(height - padded.y, padded.height)),
        };
    } finally {
        mask.close();
    }
}

/** 裁切源图，得到交给模型的「待修改区域」参考图。 */
export async function drawInpaintSourceCrop(sourceDataUrl: string, region: CanvasInpaintRegion): Promise<string> {
    const source = await loadImageBitmap(sourceDataUrl);
    try {
        const clamped = clampInpaintRegion(region, source.width, source.height);
        const canvas = document.createElement("canvas");
        canvas.width = clamped.width;
        canvas.height = clamped.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法裁切局部重绘区域");
        context.drawImage(source, clamped.x, clamped.y, clamped.width, clamped.height, 0, 0, clamped.width, clamped.height);
        return canvas.toDataURL("image/png");
    } finally {
        source.close();
    }
}

export function inpaintEditPrompt(userPrompt: string, withContext = true) {
    return [
        withContext
            ? "第一张输入图是从原图裁切出的待修改区域，第二张输入图是完整原图（仅用于核对整体构图、光影、色彩与风格，不得照搬它的构图）。"
            : "输入图是从原图裁切出的待修改区域。",
        `只修改第一张输入图中的这些内容：${userPrompt}`,
        "除上述修改外，输入图的构图、主体位置、比例、材质、光影、色彩和风格必须与原图保持一致；不要新增、删除或重绘其它元素。",
        "不要改变画面比例或添加边框、水印、文字；最终只会把该区域的生成结果羽化融合回原图。",
    ].join("\n");
}

/** 模型只负责区域重绘；最终结果以源图为底，仅在羽化后的涂抹区域内混合生成像素。 */
export async function compositeInpaintImage(sourceDataUrl: string, generatedDataUrl: string, maskDataUrl: string) {
    const [source, generated, mask] = await Promise.all([
        loadImageBitmap(sourceDataUrl),
        loadImageBitmap(generatedDataUrl),
        loadImageBitmap(maskDataUrl),
    ]);
    try {
        const width = source.width;
        const height = source.height;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("浏览器无法合成局部重绘结果");
        context.drawImage(source, 0, 0);

        const generatedContext = createScaledContext(generated, width, height, "浏览器无法读取局部重绘结果");
        const maskContext = createScaledContext(mask, width, height, "浏览器无法读取局部重绘蒙版");

        const sourcePixels = context.getImageData(0, 0, width, height);
        const generatedPixels = generatedContext.getImageData(0, 0, width, height);
        const maskPixels = maskContext.getImageData(0, 0, width, height);
        const weights = new Float32Array(width * height);
        for (let index = 0; index < weights.length; index += 1) {
            weights[index] = 1 - maskPixels.data[index * 4 + 3] / 255;
        }
        featherWeights(weights, width, height, inpaintFeatherRadius(width, height));
        const gains = inpaintColorGains(sourcePixels.data, generatedPixels.data, weights);
        blendInpaintPixels(sourcePixels.data, generatedPixels.data, weights, gains);
        context.putImageData(sourcePixels, 0, 0);
        return canvas.toDataURL("image/png");
    } finally {
        source.close();
        generated.close();
        mask.close();
    }
}

function createScaledContext(image: ImageBitmap, width: number, height: number, message: string) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error(message);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, image.width, image.height, 0, 0, width, height);
    return context;
}

function clampInpaintRegion(region: CanvasInpaintRegion, imageWidth: number, imageHeight: number): CanvasInpaintRegion {
    const x = Math.max(0, Math.min(imageWidth - 1, Math.round(region.x)));
    const y = Math.max(0, Math.min(imageHeight - 1, Math.round(region.y)));
    return {
        x,
        y,
        width: Math.max(1, Math.min(imageWidth - x, Math.round(region.width))),
        height: Math.max(1, Math.min(imageHeight - y, Math.round(region.height))),
    };
}

function inpaintFeatherRadius(width: number, height: number) {
    return Math.max(2, Math.min(32, Math.round(Math.min(width, height) * 0.006)));
}

/** 分离式盒式模糊，用来羽化涂抹边缘，避免生硬的接缝。 */
function featherWeights(weights: Float32Array, width: number, height: number, radius: number) {
    if (radius < 1) return;
    const horizontal = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * width;
        let sum = 0;
        for (let x = -radius; x <= radius; x += 1) sum += weights[rowStart + Math.max(0, Math.min(width - 1, x))];
        const span = radius * 2 + 1;
        for (let x = 0; x < width; x += 1) {
            horizontal[rowStart + x] = sum / span;
            sum -= weights[rowStart + Math.max(0, Math.min(width - 1, x - radius))];
            sum += weights[rowStart + Math.max(0, Math.min(width - 1, x + radius + 1))];
        }
    }
    for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let y = -radius; y <= radius; y += 1) sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x];
        const span = radius * 2 + 1;
        for (let y = 0; y < height; y += 1) {
            weights[y * width + x] = sum / span;
            sum -= horizontal[Math.max(0, Math.min(height - 1, y - radius)) * width + x];
            sum += horizontal[Math.max(0, Math.min(height - 1, y + radius + 1)) * width + x];
        }
    }
}

/**
 * 用未涂抹区域的原始像素估计生成结果的色偏，做一次温和的通道增益补偿，
 * 避免重绘区域出现明显的色温/亮度跳变。
 */
function inpaintColorGains(source: Uint8ClampedArray, generated: Uint8ClampedArray, weights: Float32Array) {
    const sums = [0, 0, 0];
    const samples = [0, 0, 0];
    let count = 0;
    for (let index = 0; index < weights.length; index += 1) {
        if (weights[index] > 0.05) continue;
        const offset = index * 4;
        const sourceLuma = source[offset] * 0.299 + source[offset + 1] * 0.587 + source[offset + 2] * 0.114;
        const generatedLuma = generated[offset] * 0.299 + generated[offset + 1] * 0.587 + generated[offset + 2] * 0.114;
        if (sourceLuma < 8 || sourceLuma > 247 || generatedLuma < 8 || generatedLuma > 247) continue;
        sums[0] += source[offset];
        sums[1] += source[offset + 1];
        sums[2] += source[offset + 2];
        samples[0] += generated[offset];
        samples[1] += generated[offset + 1];
        samples[2] += generated[offset + 2];
        count += 1;
    }
    if (count < 64) return [1, 1, 1];
    return [0, 1, 2].map((channel) => {
        const sourceMean = sums[channel] / count;
        const generatedMean = samples[channel] / count;
        if (generatedMean < 1) return 1;
        return Math.max(0.85, Math.min(1.18, sourceMean / generatedMean));
    });
}

function blendInpaintPixels(source: Uint8ClampedArray, generated: Uint8ClampedArray, weights: Float32Array, gains: number[]) {
    for (let index = 0; index < weights.length; index += 1) {
        const weight = weights[index];
        if (weight <= 0.002) continue;
        const offset = index * 4;
        const inverse = 1 - weight;
        source[offset] = source[offset] * inverse + Math.min(255, generated[offset] * gains[0]) * weight;
        source[offset + 1] = source[offset + 1] * inverse + Math.min(255, generated[offset + 1] * gains[1]) * weight;
        source[offset + 2] = source[offset + 2] * inverse + Math.min(255, generated[offset + 2] * gains[2]) * weight;
        source[offset + 3] = 255;
    }
}

async function loadImageBitmap(dataUrl: string) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("无法读取源图片，请重新上传后再试");
    return createImageBitmap(await response.blob());
}
