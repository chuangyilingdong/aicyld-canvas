import { App } from "antd";
import type { FormInstance } from "antd";

import type { ProjectShot } from "@/services/api/projects";
import { saveConfirmedStoryboardPrompts } from "./workflow-storyboard-confirmation";

type PromptValues = { title: string; plotDescription: string; durationSeconds: number };

export function useStoryboardPromptConfirmation<T extends PromptValues>(input: {
    shots: ProjectShot[];
    selectedShot?: ProjectShot;
    form: FormInstance<T>;
    busy: boolean;
    valuesForShot: (shot: ProjectShot, index: number) => T;
    save: (shot: ProjectShot, values: T) => Promise<void>;
    onConfirmed: () => Promise<void>;
}) {
    const { message, modal } = App.useApp();
    return async () => {
        if (input.busy || !input.shots.length) return;
        modal.confirm({
            title: `确认本章 ${input.shots.length} 个镜头的分镜提示词？`,
            content: "确认后，当前提示词和资产引用会被锁定为视频生成依据。之后再次修改并保存，会自动回到待确认状态。",
            okText: "确认全部提示词",
            cancelText: "继续编辑",
            onOk: async () => {
                try {
                    const selectedValues = input.selectedShot && input.shots.some((shot) => shot.id === input.selectedShot?.id)
                        ? await input.form.validateFields()
                        : undefined;
                    await saveConfirmedStoryboardPrompts({
                        shots: input.shots,
                        selectedShotId: input.selectedShot?.id,
                        selectedValues,
                        valuesForShot: input.valuesForShot,
                        save: input.save,
                    });
                    await input.onConfirmed();
                    message.success(`已确认 ${input.shots.length} 个镜头的分镜提示词`);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "分镜提示词确认失败");
                }
            },
        });
    };
}
