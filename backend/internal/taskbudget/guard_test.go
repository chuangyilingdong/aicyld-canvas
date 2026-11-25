package taskbudget

import (
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/testutil"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGuardIgnoresHistoricalBudgetAndRejectsArchivedBatch(t *testing.T) {
	t.Setenv("CANVAS_BILLING_SECRET", "test")
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "batch.db")), &gorm.Config{})
	testutil.CloseDBOnCleanup(t, db)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SmartFilmBatch{}, &model.Project{}); err != nil {
		t.Fatal(err)
	}
	batch := model.SmartFilmBatch{ID: "batch", UserID: "user", Status: "draft", BudgetPoints: 1, BudgetUsedPoints: 10}
	if err := db.Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	guard := New(repository.New(db), billing.NewFromEnv())
	task := &model.Task{UserID: "user", InputJSON: `{"metadata":{"batchId":"batch"}}`}
	if err := guard.Check("user", task); err != nil {
		t.Fatalf("historical budget blocked task: %v", err)
	}
	if err := db.Model(&batch).Update("status", "archived").Error; err != nil {
		t.Fatal(err)
	}
	if err := guard.Check("user", task); err == nil {
		t.Fatal("archived batch admitted task")
	}
}
