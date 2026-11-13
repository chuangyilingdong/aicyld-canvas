package repository

import (
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func addTaskBillingColumns(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, sql := range []string{
		"ALTER TABLE tasks ADD COLUMN billing_hold_id TEXT",
		"ALTER TABLE tasks ADD COLUMN billing_status TEXT",
		"ALTER TABLE tasks ADD COLUMN billing_points INTEGER NOT NULL DEFAULT 0",
	} {
		if err := db.Exec(sql).Error; err != nil && !strings.Contains(err.Error(), "duplicate column name") {
			t.Fatal(err)
		}
	}
}

func TestStaleReservedTasksAndSafeFailureGuards(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	addTaskBillingColumns(t, db)
	now := time.Now()
	old := now.Add(-3 * time.Hour)
	tasks := []model.Task{
		{ID: "queued", UserID: "u", Status: model.TaskStatusQueued, UpdatedAt: old},
		{ID: "running-no-request", UserID: "u", Status: model.TaskStatusRunning, UpdatedAt: old},
		{ID: "running-dispatched", UserID: "u", Status: model.TaskStatusRunning, ProviderRequestID: "provider-1", UpdatedAt: old},
		{ID: "refund-pending", UserID: "u", Status: model.TaskStatusFailed, UpdatedAt: old},
		{ID: "pending-reconcile", UserID: "u", Status: model.TaskStatusSucceeded, UpdatedAt: old},
		{ID: "settled", UserID: "u", Status: model.TaskStatusSucceeded, UpdatedAt: old},
	}
	if err := db.Create(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	for _, row := range []struct {
		id, hold, status string
	}{
		{"queued", "hold-queued", "reserved"},
		{"running-no-request", "hold-running", "reserved"},
		{"running-dispatched", "hold-dispatched", "reserved"},
		{"refund-pending", "hold-refund", "refund_pending"},
		{"pending-reconcile", "hold-pending", "pending_reconcile"},
		{"settled", "hold-settled", "settled"},
	} {
		if err := repo.UpdateTaskBilling("u", row.id, row.hold, row.status, 1); err != nil {
			t.Fatal(err)
		}
		if row.status == "reserved" || row.status == "settled" {
			if err := db.Model(&model.Task{}).Where("id = ?", row.id).UpdateColumn("updated_at", old).Error; err != nil {
				t.Fatal(err)
			}
		}
	}

	stale, err := repo.StaleReservedTasks(now.Add(-10*time.Minute), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(stale) != 5 {
		t.Fatalf("retryable billing task count = %d, want 5: %+v", len(stale), stale)
	}
	found := map[string]bool{}
	for _, task := range stale {
		found[task.ID] = true
	}
	for _, id := range []string{"refund-pending", "pending-reconcile"} {
		if !found[id] {
			t.Fatalf("fresh terminal billing transition %s was not retried: %+v", id, stale)
		}
	}
	if stale[0].BillingHoldID == "" {
		t.Fatalf("billing metadata was not hydrated: %+v", stale[0])
	}
	counts, err := repo.TaskBillingStatusCounts()
	if err != nil {
		t.Fatal(err)
	}
	if len(counts) != 4 {
		t.Fatalf("billing status count groups = %d, want 4: %+v", len(counts), counts)
	}

	failed, err := repo.FailStaleQueuedReservedTask("queued", now.Add(-2*time.Hour), "stale queued")
	if err != nil || !failed {
		t.Fatalf("fail queued = %v, %v", failed, err)
	}
	failed, err = repo.FailStaleRunningReservedTask("running-dispatched", now.Add(-2*time.Hour), "must not fail")
	if err != nil || failed {
		t.Fatalf("dispatched running changed = %v, %v", failed, err)
	}
	failed, err = repo.FailStaleRunningReservedTask("running-no-request", now.Add(-2*time.Hour), "stale running")
	if err != nil || !failed {
		t.Fatalf("fail running = %v, %v", failed, err)
	}

	queued, err := repo.Task("queued")
	if err != nil || queued.Status != model.TaskStatusFailed || queued.Error != "stale queued" {
		t.Fatalf("queued after failure = %+v, %v", queued, err)
	}
}
