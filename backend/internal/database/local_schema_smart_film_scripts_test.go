package database

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/testutil"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBackfillSmartFilmScriptsCreatesInitialRevision(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	testutil.CloseDBOnCleanup(t, db)
	if err := db.AutoMigrate(&model.SmartFilmBatch{}, &model.SmartFilmScriptRecord{}, &model.SmartFilmScriptRevision{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	batch := model.SmartFilmBatch{
		ID: "legacy-script-batch", UserID: "user-1", Title: "旧批次", SourceText: "想法",
		ScriptsJSON: `[{"id":"legacy-script","title":"旧剧本","content":"旧正文","status":"draft","createdAt":"2026-11-14T10:00:00Z","updatedAt":"2026-11-14T10:00:00Z"}]`,
		Status:      "draft", Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	if err := backfillSmartFilmScripts(db); err != nil {
		t.Fatal(err)
	}
	var script model.SmartFilmScriptRecord
	if err := db.First(&script, "id = ?", "legacy-script").Error; err != nil {
		t.Fatal(err)
	}
	if script.BatchID != batch.ID || script.Content != "旧正文" || script.Revision != 1 {
		t.Fatalf("script = %+v", script)
	}
	var revision model.SmartFilmScriptRevision
	if err := db.First(&revision, "script_id = ? AND version = 1", script.ID).Error; err != nil {
		t.Fatal(err)
	}
	if revision.Content != script.Content || revision.Title != script.Title {
		t.Fatalf("revision = %+v", revision)
	}
	if err := db.First(&batch, "id = ?", batch.ID).Error; err != nil {
		t.Fatal(err)
	}
	if batch.ScriptsJSON != "[]" {
		t.Fatalf("legacy scripts json = %q", batch.ScriptsJSON)
	}
}
