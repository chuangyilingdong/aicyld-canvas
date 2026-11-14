package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/model"
	"path/filepath"
	"testing"
)

func TestProductionAuthorizationMigrationPreservesV19HistoryAndRequiresColumn(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "v19.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	if err = MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.AssistantTurn{TurnID: "old", UserID: "local", CanvasID: "canvas", State: "settled", ContinuationInvalidated: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec("ALTER TABLE assistant_turns DROP COLUMN generation_authorization_json").Error; err != nil {
		t.Fatal(err)
	}
	if RequireLocalSchema(db) == nil {
		t.Fatal("missing authorization column accepted as ready")
	}
	if err = db.Exec("DELETE FROM local_schema_migrations WHERE version >= 20").Error; err != nil {
		t.Fatal(err)
	}
	var before []localSchemaMigration
	db.Order("version").Find(&before)
	if err = MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err = RequireLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	var turn model.AssistantTurn
	if err = db.First(&turn, "turn_id = ?", "old").Error; err != nil || turn.State != "settled" || !turn.ContinuationInvalidated || turn.GenerationAuthorizationJSON != "" {
		t.Fatal("old history changed", turn, err)
	}
	if err = db.Model(&turn).Update("generation_authorization_json", `{"sourceTurnId":"old"}`).Error; err != nil {
		t.Fatal(err)
	}
	if err = MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err = db.First(&turn, "turn_id = ?", "old").Error; err != nil || turn.GenerationAuthorizationJSON != `{"sourceTurnId":"old"}` {
		t.Fatal("repeated migration erased authorization", err)
	}
	var after []localSchemaMigration
	db.Order("version").Find(&after)
	if len(after) != len(before)+18 || after[len(before)].Name != "assistant-production-authorization" || after[len(before)+1].Name != "skill-market-release-metadata" || after[len(before)+5].Name != "reconcile-preview-assistant-schema" || after[len(before)+6].Name != "task-recovery-outcome" || after[len(before)+7].Name != "task-beefapi-settlement" || after[len(before)+8].Name != "managed-media-query-identity" || after[len(before)+9].Name != "skill-market-review-submissions" || after[len(before)+10].Name != "canvas-onboarding-events" || after[len(before)+11].Name != "agent-operation-query-index" || after[len(before)+12].Name != "agent-operation-result-compression" || after[len(before)+13].Name != "canvas-media-asset-identity" || after[len(before)+14].Name != "smart-film-batches" || after[len(before)+15].Name != "asset-candidate-previews" || after[len(before)+16].Name != "smart-film-production-runs" || after[len(before)+17].Name != "smart-film-production-stages" {
		t.Fatal("migration identity changed")
	}
	for i, row := range before {
		if row.Name != after[i].Name || !row.AppliedAt.Equal(after[i].AppliedAt) {
			t.Fatal("old ledger changed")
		}
	}
}
