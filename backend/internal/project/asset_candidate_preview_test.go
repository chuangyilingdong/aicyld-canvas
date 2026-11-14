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

func TestAssetCandidatePreviewHistorySelectAndDelete(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "资产图历史"})
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
			Details: map[string]any{"prompt": "雨夜街角的咖啡馆"},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	resources := []model.Resource{
		{ID: kernel.NewID(), UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"},
		{ID: kernel.NewID(), UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"},
	}
	for index := range resources {
		if err := db.Create(&resources[index]).Error; err != nil {
			t.Fatal(err)
		}
	}

	first, err := svc.UpdateProjectAssetCandidatePreview("user-1", project.ID, candidates[0].ID, UpdateProjectAssetCandidatePreviewRequest{
		ResourceID: resources[0].ID, TaskID: "task-first", Model: "image-model-a", Points: 3, Status: "ready", ExpectedRevision: ownedRevision(t, svc, project.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Previews) != 1 || !first.Previews[0].Selected {
		t.Fatalf("first preview history = %+v", first.Previews)
	}

	second, err := svc.UpdateProjectAssetCandidatePreview("user-1", project.ID, candidates[0].ID, UpdateProjectAssetCandidatePreviewRequest{
		ResourceID: resources[1].ID, TaskID: "task-second", Model: "image-model-b", Points: 5, Status: "ready", ExpectedRevision: ownedRevision(t, svc, project.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Previews) != 2 || second.PreviewResourceID != resources[1].ID || second.PreviewModel != "image-model-b" || second.PreviewPoints != 5 {
		t.Fatalf("second preview history = %+v", second)
	}
	var firstPreview model.ProjectAssetCandidatePreview
	if err := db.First(&firstPreview, "candidate_id = ? AND task_id = ?", candidates[0].ID, "task-first").Error; err != nil {
		t.Fatal(err)
	}

	selected, err := svc.SelectProjectAssetCandidatePreview("user-1", project.ID, candidates[0].ID, firstPreview.ID, SelectProjectAssetCandidatePreviewRequest{
		ExpectedRevision: ownedRevision(t, svc, project.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if selected.PreviewResourceID != resources[0].ID || selected.PreviewTaskID != "task-first" || selected.PreviewModel != "image-model-a" {
		t.Fatalf("selected preview = %+v", selected)
	}
	var secondPreview model.ProjectAssetCandidatePreview
	if err := db.First(&secondPreview, "candidate_id = ? AND task_id = ?", candidates[0].ID, "task-second").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DeleteProjectAssetCandidatePreview("user-1", project.ID, candidates[0].ID, secondPreview.ID, ownedRevision(t, svc, project.ID)); err != nil {
		t.Fatal(err)
	}
	afterPage, err := svc.ProjectAssetCandidatesPage("user-1", project.ID, 1, 10, "", "pending_confirmation", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(afterPage.Candidates) != 1 || len(afterPage.Candidates[0].Previews) != 1 || afterPage.Candidates[0].Previews[0].TaskID != "task-first" {
		t.Fatalf("preview history after delete = %+v", afterPage.Candidates)
	}
	if _, err := svc.DeleteProjectAssetCandidatePreview("user-1", project.ID, candidates[0].ID, firstPreview.ID, ownedRevision(t, svc, project.ID)); err == nil {
		t.Fatal("selected preview was deleted")
	}
}
