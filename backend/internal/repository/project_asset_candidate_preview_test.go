package repository

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCleanupOrphanedProjectAssetCandidatePreviews(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared&_foreign_keys=on"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	if err := db.AutoMigrate(&model.ProjectAssetCandidate{}, &model.ProjectAssetCandidatePreview{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	candidate := model.ProjectAssetCandidate{ID: "candidate-current", ProjectID: "project-1", Name: "角色", Category: model.AssetCategoryCharacter, Status: "pending_confirmation", CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&candidate).Error; err != nil {
		t.Fatal(err)
	}
	previews := []model.ProjectAssetCandidatePreview{
		{ID: "old-deleted", ProjectID: "project-1", CandidateID: candidate.ID, ResourceID: "resource-old", Status: "deleted", CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour)},
		{ID: "recent-deleted", ProjectID: "project-1", CandidateID: candidate.ID, ResourceID: "resource-recent", Status: "deleted", CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&previews).Error; err != nil {
		t.Fatal(err)
	}
	deleted, err := repo.CleanupOrphanedProjectAssetCandidatePreviews(now.Add(-24 * time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted preview rows = %d, want 1", deleted)
	}
	var remaining []model.ProjectAssetCandidatePreview
	if err := db.Order("id").Find(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 1 || remaining[0].ID != "recent-deleted" {
		t.Fatalf("remaining previews = %+v", remaining)
	}

	cascadeCandidate := model.ProjectAssetCandidate{ID: "candidate-cascade", ProjectID: "project-1", Name: "场景", Category: model.AssetCategoryEnvironment, Status: "pending_confirmation", CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&cascadeCandidate).Error; err != nil {
		t.Fatal(err)
	}
	cascadePreview := model.ProjectAssetCandidatePreview{ID: "cascade-preview", ProjectID: "project-1", CandidateID: cascadeCandidate.ID, ResourceID: "resource-cascade", Status: "ready", Selected: true, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&cascadePreview).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&cascadeCandidate).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CleanupOrphanedProjectAssetCandidatePreviews(now.Add(-24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	var cascadeCount int64
	if err := db.Model(&model.ProjectAssetCandidatePreview{}).Where("id = ?", cascadePreview.ID).Count(&cascadeCount).Error; err != nil {
		t.Fatal(err)
	}
	if cascadeCount != 0 {
		t.Fatalf("candidate delete left %d preview rows", cascadeCount)
	}
}
