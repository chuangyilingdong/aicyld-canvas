package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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

func TestFailedMidjourneyImageHydratesWrappedCreateReceipt(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var polls, posts atomic.Int32
	pngBytes, _ := base64.StdEncoding.DecodeString(strings.SplitN(tinyPNGDataURL, ",", 2)[1])
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost:
			posts.Add(1)
			http.Error(w, "recovery must not submit another paid job", http.StatusInternalServerError)
		case r.Method == http.MethodGet && r.URL.Path == "/v1/midjourney/tasks/task_gateway_recover":
			polls.Add(1)
			imageURL := serverURLFromRequest(r) + "/images/result.png"
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 200,
				"data": []any{map[string]any{
					"task_id": "task_gateway_recover",
					"status":  "SUCCESS",
					"image_urls": []string{
						imageURL, imageURL, imageURL, imageURL,
					},
				}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/images/result.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngBytes)
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
			InterfaceType: "midjourney",
			Model:         "midjourney-imagine",
		},
	})
	task := model.Task{
		ID: "midjourney-wrapped-recovery", UserID: "user", Type: "canvas_image",
		Status: model.TaskStatusFailed, Stage: "submission_unknown",
		Error: "图片结果尚未确认", InputJSON: string(inputJSON),
	}
	unrecoverable := "unrecoverable"
	next := time.Now().Add(24 * time.Hour)
	task.RecoveryOutcome = &unrecoverable
	task.NextPollAt = &next
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	receipt := model.ApiCallLog{
		ID: "midjourney-wrapped-receipt", UserID: task.UserID, TaskID: task.ID,
		Capability: "image", RequestKind: "create", Method: http.MethodPost,
		Path: "/v1/midjourney/generations/imagine", APIFormat: "midjourney",
		Status: model.ApiCallStatusSucceeded, StatusCode: http.StatusOK,
		ResponseBody: `{"code":200,"data":[{"status":"submitted","task_id":"task_gateway_recover"}]}`,
	}
	if err := db.Create(&receipt).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.recoverFailedImage(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.Task(task.UserID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded || stored.ImageJobID != "task_gateway_recover" || stored.ResultJSON == "" {
		t.Fatalf("task did not converge: %+v", stored)
	}
	if polls.Load() != 1 || posts.Load() != 0 {
		t.Fatalf("recovery requests: polls=%d posts=%d", polls.Load(), posts.Load())
	}
}

func serverURLFromRequest(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
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
