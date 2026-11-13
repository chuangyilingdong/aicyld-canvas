package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

func TestFailedDeclarativeImageRecoveryUsesImageJobWithoutFrozenSubmission(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var polls, posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost:
			posts.Add(1)
			http.Error(w, "recovery must not create a new task", http.StatusInternalServerError)
		case r.URL.Path == "/v1/video/generations/task-image-recover":
			polls.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "success",
				"data": map[string]any{
					"status": "SUCCESS",
					"data": map[string]any{
						"status":  "SUCCESS",
						"content": map[string]any{"image_url": tinyPNGDataURL},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc, db, _, _ := creationTestService(t)
	inputJSON, _ := json.Marshal(canvasGenerationInput{
		Mode: "image",
		Config: providerConfig{
			BaseURL:       server.URL,
			APIKey:        "test-key",
			InterfaceType: "newapi-image",
			Model:         "zhenzhen-image-g-v2.5-lowprice",
		},
	})
	task := model.Task{
		ID:         "protocol-image-recover",
		UserID:     "user",
		Type:       "canvas_image",
		Status:     model.TaskStatusFailed,
		Stage:      "任务失败",
		ImageJobID: "task-image-recover",
		InputJSON:  string(inputJSON),
	}
	unrecoverable := "unrecoverable"
	task.RecoveryOutcome = &unrecoverable
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.recoverFailedImage(newAPIImageRecoveryContext(t), task); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.Task("user", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded || stored.ResultJSON == "" || stored.RecoveryOutcome != nil {
		t.Fatalf("task did not converge to recovered result: %+v", stored)
	}
	if polls.Load() != 1 || posts.Load() != 0 {
		t.Fatalf("recovery must query only the existing task: polls=%d posts=%d", polls.Load(), posts.Load())
	}
}

func TestFailedDeclarativeImageRecoveryPendingKeepsSameProviderTask(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodGet || r.URL.Path != "/v1/video/generations/task-image-pending" {
			http.Error(w, "unexpected recovery request", http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": "success",
			"data": map[string]any{"status": "IN_PROGRESS", "data": map[string]any{"status": "running"}},
		})
	}))
	defer server.Close()

	svc, db, _, _ := creationTestService(t)
	inputJSON, _ := json.Marshal(canvasGenerationInput{
		Mode: "image",
		Config: providerConfig{
			BaseURL:       server.URL,
			APIKey:        "test-key",
			InterfaceType: "newapi-image",
			Model:         "zhenzhen-image-g-v2.5-lowprice",
		},
	})
	task := model.Task{
		ID:         "protocol-image-pending",
		UserID:     "user",
		Type:       "canvas_image",
		Status:     model.TaskStatusFailed,
		Stage:      "任务失败",
		ImageJobID: "task-image-pending",
		InputJSON:  string(inputJSON),
	}
	unrecoverable := "unrecoverable"
	task.RecoveryOutcome = &unrecoverable
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.recoverFailedImage(newAPIImageRecoveryContext(t), task); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.Task("user", task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || stored.RecoveryOutcome != nil || stored.NextPollAt == nil {
		t.Fatalf("pending recovery changed the original task: %+v", stored)
	}
	if requests.Load() != 1 {
		t.Fatalf("pending recovery made unrelated requests: %d", requests.Load())
	}
}

func newAPIImageRecoveryContext(t *testing.T) context.Context {
	t.Helper()
	manifest, err := os.ReadFile("../../../plugin-packages/newapi-image-task/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := protocol.LoadManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := protocol.NewRegistry(adapter)
	if err != nil {
		t.Fatal(err)
	}
	return generation.WithProtocolRegistry(context.Background(), registry)
}
