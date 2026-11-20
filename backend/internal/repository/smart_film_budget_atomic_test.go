package repository

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/testutil"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSmartFilmBudgetRepo(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(
		filepath.Join(t.TempDir(), "budget.db")+"?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on",
	), &gorm.Config{})
	testutil.CloseDBOnCleanup(t, db)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.Project{}, &model.CanvasProject{}, &model.SmartFilmBatch{}); err != nil {
		t.Fatal(err)
	}
	return New(db), db
}

func TestTaskAdmissionEnforcesBatchBudgetAtomically(t *testing.T) {
	repo, db := newSmartFilmBudgetRepo(t)
	batch := model.SmartFilmBatch{
		ID: "batch", UserID: "user", Title: "并发预算", SourceText: "测试",
		Status: "draft", BudgetPoints: 10,
	}
	project := model.Project{
		ID: "project", UserID: "user", BatchID: batch.ID, Name: "预算项目",
		Status: model.ProjectStatusActive,
	}
	if err := db.Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, taskID := range []string{"task-a", "task-b"} {
		taskID := taskID
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			task := model.Task{
				ID: taskID, UserID: "user", ProjectID: project.ID,
				Type: "canvas_image", Status: model.TaskStatusQueued, InputJSON: `{}`,
				BillingHoldID: "hold-" + taskID, BillingStatus: "reserved",
				BillingPoints: 6, BillingReservedPoints: 6,
			}
			results <- repo.CreateTaskWithActiveLimit(&task, 0)
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	successes, budgetFailures := 0, 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrSmartFilmBudgetExceeded):
			budgetFailures++
		default:
			t.Fatalf("unexpected admission error: %v", err)
		}
	}
	if successes != 1 || budgetFailures != 1 {
		t.Fatalf("successes=%d budgetFailures=%d, want 1/1", successes, budgetFailures)
	}
	var stored model.SmartFilmBatch
	if err := db.First(&stored, "id = ?", batch.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.BudgetUsedPoints != 6 {
		t.Fatalf("budget used = %d, want 6", stored.BudgetUsedPoints)
	}
}

func TestTaskBillingSettlementKeepsReservedAndFinalAmounts(t *testing.T) {
	repo, db := newSmartFilmBudgetRepo(t)
	batch := model.SmartFilmBatch{
		ID: "batch", UserID: "user", Title: "结算差额", SourceText: "测试",
		Status: "draft", BudgetPoints: 20,
	}
	project := model.Project{
		ID: "project", UserID: "user", BatchID: batch.ID, Name: "结算项目",
		Status: model.ProjectStatusActive,
	}
	if err := db.Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	task := model.Task{
		ID: "task", UserID: "user", ProjectID: project.ID,
		Type: "canvas_image", Status: model.TaskStatusQueued, InputJSON: `{}`,
		BillingHoldID: "hold", BillingStatus: "reserved",
		BillingPoints: 10, BillingReservedPoints: 10,
	}
	if err := repo.CreateTaskWithActiveLimit(&task, 0); err != nil {
		t.Fatal(err)
	}

	storedTask, err := repo.TaskForUser("user", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedTask.ApplyBillingResult("settled", 7, 3)
	if err := repo.UpdateTaskBilling(storedTask); err != nil {
		t.Fatal(err)
	}

	var storedBatch model.SmartFilmBatch
	if err := db.First(&storedBatch, "id = ?", batch.ID).Error; err != nil {
		t.Fatal(err)
	}
	storedTask, err = repo.TaskForUser("user", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedBatch.BudgetUsedPoints != 7 ||
		storedTask.BillingReservedPoints != 10 ||
		storedTask.BillingSettledPoints != 7 ||
		storedTask.BillingRefundedPoints != 3 {
		t.Fatalf("unexpected ledger: batch=%+v task=%+v", storedBatch, storedTask)
	}

	storedTask.ApplyBillingResult("refunded", 0, 7)
	if err := repo.UpdateTaskBilling(storedTask); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&storedBatch, "id = ?", batch.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedBatch.BudgetUsedPoints != 0 {
		t.Fatalf("budget used after refund = %d, want 0", storedBatch.BudgetUsedPoints)
	}
}

func TestSettledUsageCanExceedBatchCapAndBlocksFutureReservations(t *testing.T) {
	repo, db := newSmartFilmBudgetRepo(t)
	batch := model.SmartFilmBatch{ID: "batch-overrun", UserID: "user", Title: "预算超额结算", SourceText: "测试", Status: "draft", BudgetPoints: 10}
	project := model.Project{ID: "project-overrun", UserID: "user", BatchID: batch.ID, Name: "预算项目", Status: model.ProjectStatusActive}
	if err := db.Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	reserved := model.Task{
		ID: "task-overrun", UserID: "user", ProjectID: project.ID, Type: "canvas_image", Status: model.TaskStatusQueued, InputJSON: `{}`,
		BillingHoldID: "hold-overrun", BillingStatus: "reserved", BillingPoints: 10, BillingReservedPoints: 10,
	}
	if err := repo.CreateTaskWithActiveLimit(&reserved, 0); err != nil {
		t.Fatal(err)
	}
	settled, err := repo.TaskForUser("user", reserved.ID)
	if err != nil {
		t.Fatal(err)
	}
	settled.ApplyBillingResult("settled", 14, 0)
	if err := repo.UpdateTaskBilling(settled); err != nil {
		t.Fatalf("settlement must not be rejected by the admission cap: %v", err)
	}
	var stored model.SmartFilmBatch
	if err := db.First(&stored, "id = ?", batch.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.BudgetUsedPoints != 14 {
		t.Fatalf("actual use = %d, want 14", stored.BudgetUsedPoints)
	}
	next := model.Task{ID: "task-after-overrun", UserID: "user", ProjectID: project.ID, Type: "canvas_image", Status: model.TaskStatusQueued, InputJSON: `{}`, BillingHoldID: "hold-next", BillingStatus: "reserved", BillingPoints: 1, BillingReservedPoints: 1}
	if err := repo.CreateTaskWithActiveLimit(&next, 0); !errors.Is(err, ErrSmartFilmBudgetExceeded) {
		t.Fatalf("future reservation error = %v, want budget exceeded", err)
	}
}
