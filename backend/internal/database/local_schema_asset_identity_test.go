package database

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateCanvasMediaAssetIdentityArchivesDuplicatesAndRewritesReferences(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.TempDir()+"/asset-identity.db?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Asset{},
		&model.AssetVersion{},
		&model.ProjectAssetLink{},
		&model.ProjectAssetCandidate{},
		&model.CanvasProject{},
		&model.CanvasSnapshot{},
	); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	payload := func(id string, updatedAt time.Time) string {
		encoded, err := json.Marshal(map[string]any{
			"id": id, "kind": "image", "title": id, "coverUrl": "/api/resources/res-shared/file", "tags": []string{},
			"data": map[string]any{"dataUrl": "/api/resources/res-shared/file", "storageKey": "resource:res-shared", "width": 1, "height": 1, "bytes": 1, "mimeType": "image/png"},
		})
		if err != nil {
			t.Fatal(err)
		}
		return string(encoded)
	}
	canonicalID := "generation_" + strings.Repeat("a", 64)
	assets := []model.Asset{
		{ID: canonicalID, UserID: "owner", Kind: "image", Status: model.AssetVersionStatusConfirmed, Title: "生成图片", PayloadJSON: payload(canonicalID, now.Add(-2*time.Hour)), CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now.Add(-2 * time.Hour)},
		{ID: "asset-current", UserID: "owner", Kind: "image", Status: model.AssetVersionStatusConfirmed, Title: "画布素材", PayloadJSON: payload("asset-current", now.Add(-time.Hour)), CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour)},
		{ID: "asset-older", UserID: "owner", Kind: "image", Status: model.AssetVersionStatusConfirmed, Title: "旧素材", PayloadJSON: payload("asset-older", now.Add(-3*time.Hour)), CreatedAt: now.Add(-3 * time.Hour), UpdatedAt: now.Add(-3 * time.Hour)},
	}
	if err := db.Create(&assets).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AssetVersion{ID: "version-1", AssetID: canonicalID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: "{}", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	canvasPayload := `{"nodes":[{"id":"node-1","metadata":{"assetId":"asset-current"}}],"connections":[]}`
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "owner", Title: "测试画布", PayloadJSON: canvasPayload, Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	snapshot := model.CanvasSnapshot{ID: "snapshot-1", CanvasID: canvas.ID, UserID: "owner", Revision: 1, Title: canvas.Title, PayloadJSON: canvasPayload, CreatedAt: now}
	if err := db.Create(&snapshot).Error; err != nil {
		t.Fatal(err)
	}
	link := model.ProjectAssetLink{ID: "link-1", ProjectID: "project-1", AssetID: "asset-current", CreatedAt: now}
	if err := db.Create(&link).Error; err != nil {
		t.Fatal(err)
	}
	candidate := model.ProjectAssetCandidate{ID: "candidate-1", ProjectID: "project-1", Name: "候选", Category: model.AssetCategoryMaterial, Status: "resolved", ResolvedAssetID: "asset-current", CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&candidate).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrateCanvasMediaAssetIdentity(db); err != nil {
		t.Fatal(err)
	}
	if err := migrateCanvasMediaAssetIdentity(db); err != nil {
		t.Fatalf("idempotent migration: %v", err)
	}

	var kept model.Asset
	if err := db.First(&kept, "id = ?", canonicalID).Error; err != nil || kept.Status != model.AssetVersionStatusConfirmed {
		t.Fatalf("canonical asset lost: %+v %v", kept, err)
	}
	for _, id := range []string{"asset-current", "asset-older"} {
		var duplicate model.Asset
		if err := db.First(&duplicate, "id = ?", id).Error; err != nil || duplicate.Status != model.AssetVersionStatusArchived {
			t.Fatalf("duplicate %s status=%s err=%v", id, duplicate.Status, err)
		}
	}
	var storedCanvas model.CanvasProject
	if err := db.First(&storedCanvas, "id = ?", canvas.ID).Error; err != nil || !strings.Contains(storedCanvas.PayloadJSON, canonicalID) || strings.Contains(storedCanvas.PayloadJSON, "asset-current") {
		t.Fatalf("canvas reference not rewritten: %s %v", storedCanvas.PayloadJSON, err)
	}
	var storedSnapshot model.CanvasSnapshot
	if err := db.First(&storedSnapshot, "id = ?", snapshot.ID).Error; err != nil || !strings.Contains(storedSnapshot.PayloadJSON, canonicalID) {
		t.Fatalf("snapshot reference not rewritten: %s %v", storedSnapshot.PayloadJSON, err)
	}
	var storedLink model.ProjectAssetLink
	if err := db.First(&storedLink, "id = ?", link.ID).Error; err != nil || storedLink.AssetID != canonicalID {
		t.Fatalf("project link not rewritten: %+v %v", storedLink, err)
	}
	var storedCandidate model.ProjectAssetCandidate
	if err := db.First(&storedCandidate, "id = ?", candidate.ID).Error; err != nil || storedCandidate.ResolvedAssetID != canonicalID {
		t.Fatalf("candidate not rewritten: %+v %v", storedCandidate, err)
	}

	duplicate := model.Asset{ID: "asset-new-duplicate", UserID: "owner", Kind: "image", Status: model.AssetVersionStatusConfirmed, PayloadJSON: payload("asset-new-duplicate", now), CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&duplicate).Error; err == nil {
		t.Fatal("unique media identity index accepted a duplicate active asset")
	}
}
