package project

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestIgnoreProjectAssetCandidateKeepsOptionalAssetOutOfGate(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "可选资产"})
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
			UnitID: unit.ID, Name: "一次性邮戳", Category: string(model.AssetCategoryProp),
			Details: map[string]any{"prompt": "桌面上的邮戳"},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	before := ownedRevision(t, svc, project.ID)
	ignored, err := svc.IgnoreProjectAssetCandidate("user-1", project.ID, candidates[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if ignored.Status != "ignored" || ignored.ResolvedAssetID != "" {
		t.Fatalf("ignored candidate = %+v", ignored)
	}
	pending, err := svc.repo.PendingProjectAssetCandidateCount(project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("pending candidates = %d, want 0", pending)
	}
	if after := ownedRevision(t, svc, project.ID); after <= before {
		t.Fatalf("project revision = %d, want > %d", after, before)
	}
	var stored model.ProjectAssetCandidate
	if err := db.First(&stored, "id = ?", candidates[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != "ignored" {
		t.Fatalf("stored status = %q, want ignored", stored.Status)
	}
	if _, err := svc.IgnoreProjectAssetCandidate("user-1", project.ID, candidates[0].ID); err == nil {
		t.Fatal("ignoring an already handled candidate must fail")
	}
}

func TestSmartFilmFixedCharacterCountUsesDistinctMeaningfulNames(t *testing.T) {
	config := SmartFilmBatchConfig{
		InputAssetRoles: map[string]string{"a": "character", "b": "character", "c": "prop"},
		InputAssetNames: map[string]string{"a": "小满", "b": "阿豆"},
	}
	if got := smartFilmFixedCharacterCount(config); got != 2 {
		t.Fatalf("fixed character count = %d, want 2", got)
	}
	config.InputAssetNames = map[string]string{"a": "小满", "b": "小满"}
	if got := smartFilmFixedCharacterCount(config); got != 1 {
		t.Fatalf("same named character views = %d, want 1", got)
	}
	config.InputAssetNames = map[string]string{"a": "生成图片", "b": "生成图片"}
	if got := smartFilmFixedCharacterCount(config); got != 2 {
		t.Fatalf("generic titles must remain distinct references = %d, want 2", got)
	}
}
