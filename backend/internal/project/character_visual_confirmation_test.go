package project

import (
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func TestCharacterTurnaroundRequiresVisualConfirmation(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "角色形象确认"})
	if err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateProjectCharacter("user-1", project.ID, CreateProjectCharacterRequest{
		Name: "时空守护鲸",
		Definition: map[string]any{
			"role": "原创对手角色", "appearance": "蓝白色鲸形生物", "physique": "修长流线型",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: kernel.NewID(), UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.BindCharacterTurnaround("user-1", project.ID, created.Asset.ID, "task-turnaround", resource.ID, "角色三视图"); err != nil {
		t.Fatal(err)
	}
	pending, err := svc.ProjectCharacter("user-1", project.ID, created.Asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Character.VisualStatus != "pending_confirmation" {
		t.Fatalf("visual status = %q, want pending_confirmation", pending.Character.VisualStatus)
	}
	pendingVersion, err := svc.repo.AssetVersion(pending.Asset.PrimaryVersionID)
	if err != nil {
		t.Fatal(err)
	}
	if visual, err := svc.assetVersionHasVisualReference("user-1", pendingVersion); err != nil || visual {
		t.Fatalf("pending visual reference = %v, err = %v", visual, err)
	}

	confirmed, err := svc.ConfirmProjectCharacterVisual("user-1", project.ID, created.Asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Character.VisualStatus != "ready" {
		t.Fatalf("visual status = %q, want ready", confirmed.Character.VisualStatus)
	}
	confirmedVersion, err := svc.repo.AssetVersion(confirmed.Asset.PrimaryVersionID)
	if err != nil {
		t.Fatal(err)
	}
	if visual, err := svc.assetVersionHasVisualReference("user-1", confirmedVersion); err != nil || !visual {
		t.Fatalf("confirmed visual reference = %v, err = %v", visual, err)
	}
	versions, err := svc.repo.AssetVersions(created.Asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 3 {
		t.Fatalf("version count = %d, want initial + turnaround + confirmation", len(versions))
	}
}
