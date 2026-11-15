import { useState } from "react";
import { App, Button } from "antd";
import { CheckCircle2 } from "lucide-react";

import { selectShotArtifact, type ProjectShot, type ShotArtifact } from "@/services/api/projects";
import { canSelectShotArtifact } from "./shot-artifact-selection";

export function ShotArtifactSelectButton({ projectId, shot, artifact, onSelected }: {
    projectId: string;
    shot: ProjectShot;
    artifact?: ShotArtifact;
    onSelected: (artifact: ShotArtifact) => void;
}) {
    const { message } = App.useApp();
    const [selecting, setSelecting] = useState(false);
    const eligible = canSelectShotArtifact(shot, artifact);
    if (!eligible || !artifact) return null;
    const select = async () => {
        setSelecting(true);
        try {
            const result = await selectShotArtifact(projectId, shot.id, artifact.id);
            onSelected(result.artifact);
            message.success(`已将 v${artifact.version} 设为当前产物`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "设置当前产物失败");
        } finally {
            setSelecting(false);
        }
    };
    return <Button size="small" icon={<CheckCircle2 className="size-3.5" />} loading={selecting} onClick={() => void select()}>设为当前</Button>;
}
