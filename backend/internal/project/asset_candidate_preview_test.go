package project

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func TestAssetCandidatePreviewReusesExistingGeneratedAsset(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "资产图复用"})
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
	resource := model.Resource{ID: kernel.NewID(), UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateProjectAssetCandidatePreview("user-1", project.ID, candidates[0].ID, UpdateProjectAssetCandidatePreviewRequest{
		ResourceID: resource.ID, TaskID: "task-preview", Status: "ready", ExpectedRevision: ownedRevision(t, svc, project.ID),
	}); err != nil {
		t.Fatal(err)
	}

	existingID := kernel.NewID()
	existingVersionID := kernel.NewID()
	payload, err := json.Marshal(map[string]any{
		"id": existingID, "title": "生成图片", "category": model.AssetCategoryMaterial, "status": model.AssetVersionStatusConfirmed,
		"primaryVersionId": existingVersionID, "data": map[string]any{"storageKey": "resource:" + resource.ID},
		"metadata": map[string]any{"source": "generation-task"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Asset{
		ID: existingID, UserID: "user-1", Kind: "image", Category: model.AssetCategoryMaterial,
		Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: existingVersionID, Title: "生成图片", PayloadJSON: string(payload),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AssetVersion{
		ID: existingVersionID, AssetID: existingID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: "{}",
	}).Error; err != nil {
		t.Fatal(err)
	}

	confirmed, err := svc.ConfirmProjectAssetCandidate("user-1", project.ID, candidates[0].ID, ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.ID != existingID || confirmed.Title != "雨夜咖啡馆" || confirmed.Category != model.AssetCategoryEnvironment {
		t.Fatalf("confirmed asset = %+v, want reused generated asset relabeled for candidate", confirmed)
	}
	var assetCount int64
	if err := db.Model(&model.Asset{}).Where("json_extract(payload_json, '$.data.storageKey') = ?", "resource:"+resource.ID).Count(&assetCount).Error; err != nil {
		t.Fatal(err)
	}
	if assetCount != 1 {
		t.Fatalf("asset count = %d, want 1", assetCount)
	}
	var link model.ProjectAssetLink
	if err := db.First(&link, "project_id = ? AND asset_id = ?", project.ID, existingID).Error; err != nil {
		t.Fatal(err)
	}
	var storedCandidate model.ProjectAssetCandidate
	if err := db.First(&storedCandidate, "id = ?", candidates[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedCandidate.Status != "confirmed" || storedCandidate.ResolvedAssetID != existingID {
		t.Fatalf("candidate = %+v", storedCandidate)
	}
}

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
