package project

import (
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func TestAssetCandidatePreviewBecomesConfirmedImageAsset(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "资产图确认"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "第一场", SourceText: "雨夜咖啡馆"})
	if err != nil {
		t.Fatal(err)
	}
	candidates, err := svc.CreateProjectAssetCandidates("user-1", project.ID, CreateAssetCandidatesRequest{
		Source: AssetCandidateSourceChapterCharacter,
		Candidates: []AssetCandidateInput{{
			UnitID: unit.ID, Name: "雨夜咖啡馆", Category: string(model.AssetCategoryEnvironment),
			Details: map[string]any{"prompt": "雨夜街角的咖啡馆，暖色灯光"},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: kernel.NewID(), UserID: "user-1", Kind: "image", Status: "ready", MimeType: "image/png",
		Width: 1024, Height: 1024,
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	revision := ownedRevision(t, svc, project.ID)
	updated, err := svc.UpdateProjectAssetCandidatePreview("user-1", project.ID, candidates[0].ID, UpdateProjectAssetCandidatePreviewRequest{
		ResourceID: resource.ID, TaskID: "task-preview", Status: "ready", ExpectedRevision: revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.PreviewResourceID != resource.ID || updated.PreviewStatus != "ready" {
		t.Fatalf("preview was not persisted: %+v", updated)
	}
	asset, err := svc.ConfirmProjectAssetCandidate("user-1", project.ID, candidates[0].ID, ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if asset.MediaType != "image" || asset.StorageKey != "resource:"+resource.ID {
		t.Fatalf("confirmed asset = %+v, want image preview", asset)
	}
	var representation model.AssetRepresentation
	if err := db.First(&representation, "asset_version_id = ?", asset.PrimaryVersionID).Error; err != nil {
		t.Fatal(err)
	}
	if representation.ResourceID != resource.ID || representation.MediaType != "image" || representation.Role != "primary" {
		t.Fatalf("representation = %+v", representation)
	}
}
