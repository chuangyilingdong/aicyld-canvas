package taskdelivery

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	localasset "infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type deletedVisibilityNopQuota struct{}

func (deletedVisibilityNopQuota) ReserveUpload(string, int64, string) (string, error) { return "", nil }
func (deletedVisibilityNopQuota) ReserveChunked(string, int64, string) (string, error) {
	return "", nil
}
func (deletedVisibilityNopQuota) ReserveRetry(string, int64, string) (string, error) { return "", nil }
func (deletedVisibilityNopQuota) ReserveGenerated(string, int64, string) (string, error) {
	return "", nil
}
func (deletedVisibilityNopQuota) ReserveGeneratedRetry(string, int64, string) (string, error) {
	return "", nil
}
func (deletedVisibilityNopQuota) Release(string, string, int64, string)      {}
func (deletedVisibilityNopQuota) ReleaseRetry(string, string, int64, string) {}
func (deletedVisibilityNopQuota) Commit(string, int64, string)               {}

type deletedVisibilityNopLifecycle struct{}

func (deletedVisibilityNopLifecycle) RecordActivity(string, string, int) {}
func (deletedVisibilityNopLifecycle) AfterResourceReady(*model.Resource) {}
func (deletedVisibilityNopLifecycle) AppearanceReferencedIDs([]string) map[string]struct{} {
	return nil
}
func (deletedVisibilityNopLifecycle) RecycleRetentionDays() (int, error)    { return 30, nil }
func (deletedVisibilityNopLifecycle) WorkerID() string                      { return "test-worker" }
func (deletedVisibilityNopLifecycle) RunBackground(fn func())               {}
func (deletedVisibilityNopLifecycle) DeleteUserAsset(string, string) error  { return nil }
func (deletedVisibilityNopLifecycle) WithStorageLock(fn func() error) error { return fn() }

func newDeletedAssetVisibilityFixture(t *testing.T) (*gorm.DB, *repository.Repository, *localasset.Service, *Deliverer, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	repo := repository.New(db)
	assetSvc := localasset.NewService(localasset.Dependencies{
		Repository: localasset.NewRepository(repo),
		Blobs:      localasset.NewFileStore(dataDir),
		Quota:      deletedVisibilityNopQuota{},
		Lifecycle:  deletedVisibilityNopLifecycle{},
	})
	deliverer := New(NewRepoStore(repo, localtask.PublicTaskInputJSON), nil)
	return db, repo, assetSvc, deliverer, dataDir
}

func writeResourceBlob(t *testing.T, dataDir string, objectKey string) string {
	t.Helper()
	fullPath := filepath.Join(dataDir, "resources", filepath.FromSlash(objectKey))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fullPath, []byte("media-bytes"), 0o640); err != nil {
		t.Fatal(err)
	}
	return fullPath
}

func TestDeleteGeneratedAssetTombstonesTaskOutputAndCleansResource(t *testing.T) {
	db, repo, assetSvc, deliverer, dataDir := newDeletedAssetVisibilityFixture(t)
	const userID = "user-573"
	const projectID = "canvas-573"
	const resourceID = "res-image-573"
	const taskID = "task-image-573"

	now := time.Now().UTC()
	resource := model.Resource{
		ID: resourceID, UserID: userID, Kind: "image", Provider: "local",
		ObjectKey: "users/user-573/image/gen.png", MimeType: "image/png", Size: 1024,
		Status: model.ResourceStatusReady, CreatedAt: now, UpdatedAt: now,
	}
	taskRow := model.Task{
		ID: taskID, UserID: userID, ProjectID: projectID, Type: "canvas_image",
		Status: model.TaskStatusSucceeded, Stage: "生成完成", Prompt: "雨夜街景",
		ResultJSON: `{"mode":"image","images":[{"storageKey":"resource:res-image-573","url":"/api/resources/res-image-573/file","width":1024,"height":1024}]}`,
		CreatedAt:  now, UpdatedAt: now,
	}
	blobPath := writeResourceBlob(t, dataDir, resource.ObjectKey)
	for _, row := range []any{&resource, &taskRow} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := deliverer.Deliver(taskRow); err != nil {
		t.Fatalf("Deliver() error = %v", err)
	}
	stored, err := deliverer.LoadedOutputs(taskID)
	if err != nil || len(stored) != 1 || stored[0].MaterializedAssetID == "" {
		t.Fatalf("generated output missing: %+v err=%v", stored, err)
	}
	assetID := stored[0].MaterializedAssetID
	if err := assetSvc.DeleteUserAssetWithResources(userID, assetID); err != nil {
		t.Fatalf("DeleteUserAssetWithResources() error = %v", err)
	}
	var resCount, jobCount int64
	if err := db.Model(&model.Resource{}).Where("id = ?", resourceID).Count(&resCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ResourceDeletionJob{}).Where("resource_id = ?", resourceID).Count(&jobCount).Error; err != nil {
		t.Fatal(err)
	}
	if resCount != 0 || jobCount != 1 {
		t.Fatalf("resource cleanup failed: resource=%d jobs=%d", resCount, jobCount)
	}
	assetSvc.DrainDeletionJobs(10)
	if _, err := os.Stat(blobPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected physical file removed, stat err=%v", err)
	}

	generatedRows, generatedTotal, err := repo.UserAssetsPage(userID, 1, 20, repository.UserAssetPageFilter{Status: "active", Generated: true})
	if err != nil {
		t.Fatal(err)
	}
	if generatedTotal != 0 || len(generatedRows) != 0 {
		t.Fatalf("generation history still contains deleted asset: total=%d rows=%+v", generatedTotal, generatedRows)
	}

	summaries := localtask.SummariesForOutput([]model.Task{taskRow})
	AttachTaskSummaryDeliveries(
		deliverer,
		[]model.Task{taskRow},
		summaries,
		func([]model.Task) map[string]localtask.OutcomeFacts { return map[string]localtask.OutcomeFacts{} },
		generation.PersistedFailureBlocksRetry,
		nil,
		nil,
	)
	if summaries[0].PreviewURL != "" || summaries[0].ResultState != localtask.ResultStateFailedPermanent {
		t.Fatalf("deleted asset summary not tombstoned: %+v", summaries[0])
	}
	if len(summaries[0].Outputs) != 1 || summaries[0].Outputs[0].MaterializationErrorCode != localtask.MaterializeErrorAssetDeleted || summaries[0].Outputs[0].MaterializedAssetID != "" || summaries[0].Outputs[0].ResourceID != "" {
		t.Fatalf("generation history output was not tombstoned: %+v", summaries[0].Outputs)
	}
}
