import { expect, spyOn, test } from "bun:test";

import { explainGenerationError, generationErrorMessage, generationFailureMetadata } from "../src/lib/generation-error";
import * as runtimeMode from "../src/lib/runtime-mode";
import { ApiError } from "../src/services/api/request";

test("local generation errors do not expose hosted object-storage wording", () => {
    expect(generationErrorMessage("OSS 上传失败：对象存储不可用")).toBe("本地参考素材保存失败，请检查本地资源目录后重试");
    expect(generationErrorMessage("参考图片上传失败")).toBe("本地参考素材保存失败，请检查本地资源目录后重试");
});

test("HTTP 402 explains the upstream billing cause and exposes a stable canvas error code", () => {
    const raw = "模型服务请求失败（HTTP 402）";
    expect(generationErrorMessage(raw)).toContain("计费或额度");
    expect(generationErrorMessage(raw)).not.toContain("余额不足");
    expect(generationFailureMetadata(raw, "prompt")).toEqual({
        errorDetails: generationErrorMessage(raw),
        generationErrorCode: "quota_unknown",
        generationErrorSummary: raw,
    });
});

test("HTTP 402 keeps the classified upstream cause without exposing its raw body", () => {
    expect(generationErrorMessage({ status: 402, data: { error: { message: "subscription required api_key=PRIVATE" } } })).toContain("计费或额度");
    expect(generationErrorMessage({ status: 402, data: { error: { message: "subscription required api_key=PRIVATE" } } })).not.toContain("PRIVATE");
});

test("stale browser-local references explain that they must be uploaded again", () => {
    const raw = "参考图片只保存在原浏览器的临时缓存里，当前浏览器无法读取；请重新上传这张图片后再生成。";
    expect(generationErrorMessage(raw)).toBe("参考素材只保存在原浏览器的临时缓存里，当前浏览器无法读取；请重新上传参考素材后再生成");
});

test("hosted upload failures give users an action instead of object-storage configuration wording", () => {
    const mode = spyOn(runtimeMode, "isLocalRuntimeMode").mockReturnValue(false);
    try {
        expect(generationErrorMessage("OSS 上传失败：对象存储不可用")).toBe("参考素材上传失败，已自动重试；请检查网络后重新上传");
    } finally {
        mode.mockRestore();
    }
});

test("platform points insufficiency is not misreported as a provider quota problem", () => {
    const live = explainGenerationError(new ApiError("积分不足", { status: 402, reason: "invalid_argument" }));
    expect(live.category).toBe("quota_user");
    expect(live.reason).toBe("当前账号积分余额不足");
    expect(live.action).toContain("充值");
    expect(live.message).not.toContain("供应商");

    const persisted = explainGenerationError({ code: "quota_unknown", message: "积分不足 模型服务拒绝了计费或额度相关请求" });
    expect(persisted.category).toBe("quota_user");
    expect(persisted.reason).toBe("当前账号积分余额不足");
    expect(persisted.action).toContain("降低视频时长、分辨率");
});
