import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";

import { smartFilmShotDirection, smartFilmShotTimings } from "./smart-film-whole-film-prompt";
import { currentRevision } from "./workflow-shared";

type StoryboardEntry = {
    shot: ProjectShot;
    artifact: ShotArtifact;
};

type SmartFilmEditPromptInput = {
    detail: ProjectDetail;
    shots: ProjectShot[];
    entries: StoryboardEntry[];
    targetSeconds: number;
    videoResourceId: string;
    taskId?: string;
    skillName?: string;
};

export function buildSmartFilmEditPrompt(input: SmartFilmEditPromptInput) {
    const timings = smartFilmShotTimings(input.entries, input.targetSeconds);
    const shotIds = input.shots.map((shot, index) => `镜头${index + 1}-${shot.id.slice(0, 8)}`);
    const dialogueEntries = input.shots.flatMap((shot, index) => {
        const dialogue = currentRevision(input.detail, shot)?.dialogue?.trim();
        return dialogue ? [{ index, dialogue }] : [];
    });
    const sourceName = input.taskId ? `整片视频-${input.taskId.slice(0, 8)}.mp4` : "已生成整片视频.mp4";
    const timelineRows = input.shots.map((shot, index) => {
        const revision = currentRevision(input.detail, shot);
        const timing = timings[index];
        const picture = smartFilmShotDirection(revision?.videoPrompt || revision?.plotDescription || shot.description || shot.title);
        const dialogue = dialogueEntries.filter((entry) => entry.index === index).map((entry) => entry.dialogue).join("；");
        return [
            `TL-${String(index + 1).padStart(3, "0")}`,
            sourceName,
            shotIds[index],
            "待实测",
            "待实测",
            `${formatSeconds(timing.start)}–${formatSeconds(timing.end)} 秒`,
            "硬切或按动作完成点微调",
            escapeCell(picture),
            escapeCell(dialogue ? `对白：${dialogue}` : "保留现场动作音与环境声"),
            `承接分镜计划中的第 ${index + 1} 个叙事节点`,
        ];
    });

    return `# ${input.detail.project.name} · 整片剪辑提示词

## 0. 版本与边界

- 状态：ready，预估时间线；源入出点、实测时长、帧率和音轨需拿到文件后回填
- 项目：${input.detail.project.name}
- 画面：${input.detail.project.aspectRatio}
- 目标成片时长：${formatSeconds(input.targetSeconds)} 秒
- 剪辑规范：${input.skillName || "平台默认剪辑规范"}
- 素材依据：已生成整片视频、分镜顺序、逐镜动作说明与对白

## 1. 定剪目标

- 开场前 3 秒保留最强异常、冲突或任务钩子，不额外加空镜。
- 按分镜顺序保持因果主线，允许模型生成结果中的自然运动跨越原计划切点。
- 优先保留动作完成、台词尾音、反应落点和关键道具交接，不使用无意义转场填充节奏。
- 结尾落在最后一个可读动作、台词或结果画面，不额外增加解释性旁白。
- 默认硬切；成片已经连贯时只做节奏微调，不强制拆成逐镜硬切。

## 2. 素材盘点

| 文件 | 覆盖 SHOT | 实测时长 | 有效区间 | 画幅/FPS | 音轨 | 问题 | 结论 |
|---|---|---:|---|---|---|---|---|
| \`${sourceName}\` | ${shotIds.join("；")} | 待实测 | 待实测 | ${escapeCell(input.detail.project.aspectRatio)}/待实测 | 待实测 | 需核对完整时长、口型和音轨 | 可剪，先回填实测值 |

## 3. 时间线主表

> 下表时间是按分镜时长比例计算出的节奏检查点，不是源文件实测时间码。拿到成片后先测量真实时长，再转换为 \`HH:MM:SS:FF\`。

| TL | 源文件 | SHOT | 源入 | 源出 | 时间线区间 | 入/出处理 | 画面 | 声音 | 理由 |
|---|---|---|---|---|---|---|---|---|---|
${timelineRows.map((row) => `| ${row.join(" | ")} |`).join("\n")}

## 4. 转场与画面处理

- 默认转场：硬切。
- 仅当动作方向、视线、遮挡或声音命中能提供明确动机时才做非硬切。
- 不用叠化、闪白、镜像或无动机遮罩掩盖动作断裂和生成缺陷。
- 重新生成后若构图变化，优先稳定、轻裁切和色彩匹配；不得拉伸人物。
- 局部变速只用于补足节奏，不改变对白速度和动作因果。

## 5. 声音设计

${dialogueEntries.length ? dialogueEntries.map((entry) => `- 图片${entry.index + 1} / ${shotIds[entry.index]}：「${entry.dialogue}」；保留完整语义，核对口型。`).join("\n") : "- 无明确对白；保留环境声、动作音效和项目 BGM。"}
- SFX：动作接触、入水、机械运转和结果落地处强化，峰值相对对白约 -6 dB。
- 环境声：持续保持场景底噪，避免全片静音或连续堆叠无关音效。
- BGM：随情绪转折进入和退场，对白与动作峰值处自动 Ducking。
- 电平基准：对白最清晰；动作 SFX 约 -6 dB；环境与 BGM 约 -14～-18 dB。

## 6. 字幕与包装

- 字幕语言与断句遵循对白原文，不擅自改写含义。
- ${input.detail.project.aspectRatio === "16:9" ? "16:9 横屏" : "9:16 竖屏"}字幕放在平台安全区，避开脸、眼睛、关键动作和证据文字。
- 说话者变化、画外音和内心独白需明确区分。
- 片头、片尾和平台 CTA 不得遮挡核心画面。

## 7. 调色与导出

- 保持角色肤色、服装主色、场景光源和项目画风一致。
- 不混用日夜色温，不因局部调色改变关键道具颜色。
- 母版：保持 ${input.detail.project.aspectRatio}，分辨率、FPS、码率和音频采样率以源文件实测值为准。
- 平台版另外导出，保留字幕安全区，不裁掉关键手部动作或结果信息。

## 8. 成片质检

- [ ] 每个时间线检查点都能对应到已生成整片中的真实画面。
- [ ] 对白、口型、字幕和说话者一致。
- [ ] SFX 不盖对白，BGM 在关键对白和爆发处正确避让。
- [ ] 无黑场、缺帧、重复动作、无解释跳轴或错误镜像。
- [ ] 道具、伤痕、服装、天气与空间状态连续。
- [ ] 开场抓力、中段推进、情绪峰谷和结尾落点成立。
- [ ] 画幅、时长、帧率、码率和响度符合平台交付。

## 9. 交给剪辑执行者的指令

严格按本提示词和实际素材组装时间线。先核对成片真实时长、帧率和音轨，再把“待实测”替换为真实源入出点。不得自行改写台词、增加无动机转场、改变画幅或把计划时间冒充实测时间。遇到动作断裂、口型错误、字幕遮挡或素材缺失，停止对应 TL，并列出证据时间点和可选修复方案。

视频资源：${input.videoResourceId}`;
}

function escapeCell(value: string) {
    return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function formatSeconds(value: number) {
    return String(Math.round(Math.max(0, value) * 10) / 10);
}
