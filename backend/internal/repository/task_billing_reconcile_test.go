package repository

import (
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"infinite-canvas/backend/internal/model"
)

func TestStaleReservedTasksAndSafeFailureGuards(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	old := now.Add(-3 * time.Hour)
	tasks := []model.Task{
		{ID: "queued", UserID: "u", Status: model.TaskStatusQueued, BillingHoldID: "hold-queued", BillingStatus: "reserved", UpdatedAt: old},
		{ID: "running-no-request", UserID: "u", Status: model.TaskStatusRunning, BillingHoldID: "hold-running", BillingStatus: "reserved", UpdatedAt: old},
		{ID: "running-dispatched", UserID: "u", Status: model.TaskStatusRunning, BillingHoldID: "hold-dispatched", BillingStatus: "reserved", ProviderRequestID: "provider-1", UpdatedAt: old},
		{ID: "refund-pending", UserID: "u", Status: model.TaskStatusFailed, BillingHoldID: "hold-refund", BillingStatus: "refund_pending", UpdatedAt: old},
		{ID: "pending-reconcile", UserID: "u", Status: model.TaskStatusSucceeded, BillingHoldID: "hold-pending", BillingStatus: "pending_reconcile", UpdatedAt: old},
		{ID: "settled", UserID: "u", Status: model.TaskStatusSucceeded, BillingHoldID: "hold-settled", BillingStatus: "settled", UpdatedAt: old},
	}
	if err := db.Create(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	for _, task := range tasks {
		if err := db.Model(&model.Task{}).Where("id = ?", task.ID).UpdateColumn("updated_at", old).Error; err != nil {
			t.Fatal(err)
		}
	}

	repo := New(db)
	stale, err := repo.StaleReservedTasks(now.Add(-10*time.Minute), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(stale) != 5 {
		t.Fatalf("retryable billing task count = %d, want 5: %+v", len(stale), stale)
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
