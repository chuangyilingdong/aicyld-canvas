import type { ProjectShot, ShotArtifact } from "@/services/api/projects";

export function canSelectShotArtifact(shot: ProjectShot, artifact?: ShotArtifact) {
    return Boolean(
        artifact
        && artifact.status === "ready"
        && artifact.resourceId
        && artifact.revisionId === shot.currentRevisionId
        && !artifact.selected,
    );
}
