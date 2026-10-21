package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
)

func imageRecoveryTestTask() model.Task {
	return model.Task{ID: "task-image-recovery", UserID: "user", ProjectID: "canvas", Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{"mode":"image"}`, Error: "取回图片失败"}
}

func imageRecoveryTestReceipt(task model.Task) model.ApiCallLog {
	return model.ApiCallLog{
		ID: "receipt", UserID: task.UserID, TaskID: task.ID, Capability: "image", RequestKind: "create", Method: "POST",
		APIFormat: "openai", Path: "/v1/images/generations", Status: model.ApiCallStatusSucceeded, StatusCode: 200,
		ResponseBody: `{"data":[{"url":"https://8.8.8.8/image.png"}]}`,
	}
}

func TestRetryAcceptedImageUsesOriginalReceiptWithoutCreate(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	task := imageRecoveryTestTask()
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	receipt := imageRecoveryTestReceipt(task)
	if err := db.Create(&receipt).Error; err != nil {
		t.Fatal(err)
	}

	restored, err := s.RetryTask(task.UserID, task.ID)
	if err != nil || restored == nil || restored.Status != model.TaskStatusSucceeded {
		t.Fatalf("retry did not restore original receipt: %+v err=%v", restored, err)
	}
	var payload struct {
		Mode   string           `json:"mode"`
		Images []map[string]any `json:"images"`
	}
	if err := json.Unmarshal([]byte(restored.ResultJSON), &payload); err != nil || payload.Mode != "image" || len(payload.Images) != 1 {
		t.Fatalf("restored result = %s err=%v", restored.ResultJSON, err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("retry created another task: count=%d err=%v", count, err)
	}
}

func TestImageReceiptRecoveryRejectsAcceptedButNonFinalResponses(t *testing.T) {
	for _, statusCode := range []int{0, 201, 202, 204} {
		t.Run(fmt.Sprintf("status-%d", statusCode), func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			task := imageRecoveryTestTask()
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			receipt := imageRecoveryTestReceipt(task)
			receipt.StatusCode = statusCode
			if err := db.Create(&receipt).Error; err != nil {
				t.Fatal(err)
			}
			if restored, handled, err := s.recoverAcceptedImage(task); !handled || err == nil || restored != nil {
				t.Fatalf("accepted non-final receipt status=%d produced recovered=%+v handled=%v err=%v", statusCode, restored, handled, err)
			}
			stored, err := s.repo.Task(task.ID)
			if err != nil || stored.Status != model.TaskStatusFailed {
				t.Fatalf("non-final receipt changed task: %+v err=%v", stored, err)
			}
		})
	}
}

func TestImageReceiptRecoveryRejectsAmbiguousAcceptedReceipts(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	task := imageRecoveryTestTask()
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	success := imageRecoveryTestReceipt(task)
	unknown := imageRecoveryTestReceipt(task)
	unknown.ID = "receipt-unknown"
	unknown.StatusCode = 0
	if err := db.Create(&success).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&unknown).Error; err != nil {
		t.Fatal(err)
	}
	if restored, handled, err := s.recoverAcceptedImage(task); !handled || err == nil || restored != nil {
		t.Fatalf("ambiguous accepted receipts recovered=%+v handled=%v err=%v", restored, handled, err)
	}
}

func TestImageReceiptRecoveryNeedsACompleteURLResult(t *testing.T) {
	for _, tc := range []struct {
		name    string
		body    string
		handled bool
	}{
		{name: "malformed", body: `{"data":`, handled: true},
		{name: "empty", body: `{"data":[]}`, handled: true},
		{name: "business error", body: `{"code":500,"data":[{"url":"https://8.8.8.8/image.png"}]}`, handled: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			task := imageRecoveryTestTask()
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			receipt := imageRecoveryTestReceipt(task)
			receipt.ResponseBody = tc.body
			if err := db.Create(&receipt).Error; err != nil {
				t.Fatal(err)
			}
			restored, handled, err := s.recoverAcceptedImage(task)
			if restored != nil || handled != tc.handled || (tc.handled && err == nil) {
				t.Fatalf("receipt %s recovered=%+v handled=%v err=%v", tc.name, restored, handled, err)
			}
		})
	}
}

func TestImageTaskResultFromAsyncProviderState(t *testing.T) {
	state := map[string]any{
		"code": "success",
		"data": map[string]any{
			"task_id": "task-async",
			"status":  "IN_PROGRESS",
			"data": map[string]any{
				"status": "succeeded",
				"content": map[string]any{
					"image_url":  "https://8.8.8.8/first.png",
					"image_urls": []any{"https://8.8.8.8/first.png", "https://8.8.8.8/second.png"},
				},
				"upstream": map[string]any{"response": map[string]any{"results": []any{map[string]any{"url": "https://8.8.8.8/second.png"}}}},
			},
		},
	}
	status, urls, reason := imageTaskResultFromState(state)
	if status != "succeeded" || reason != "" {
		t.Fatalf("status=%q reason=%q state=%#v", status, reason, state)
	}
	if len(urls) != 2 || urls[0] != "https://8.8.8.8/first.png" || urls[1] != "https://8.8.8.8/second.png" {
		t.Fatalf("urls=%#v", urls)
	}
	failedStatus, _, failedReason := imageTaskResultFromState(map[string]any{"data": map[string]any{"status": "failed", "fail_reason": "upstream rejected"}})
	if failedStatus != "failed" || failedReason != "upstream rejected" {
		t.Fatalf("failed status=%q reason=%q", failedStatus, failedReason)
	}
}

func TestImageTaskCreatePathRecognition(t *testing.T) {
	for _, path := range []string{"/v1/images/generations", "/v1/images/edits", "/v1/video/generations"} {
		if !isImageTaskCreatePath(path) {
			t.Fatalf("%s should be recognized as an image create path", path)
		}
	}
	if isImageTaskCreatePath("/v1/models") {
		t.Fatal("models endpoint was treated as a paid image create")
	}
}

func TestAsyncImageRecoveryQueriesOriginalProviderTask(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	task := imageRecoveryTestTask()
	task.ProviderRequestID = "task-async"
	task.InputJSON = `{"mode":"image","config":{"baseUrl":"https://example.com","apiKey":"test-key","interfaceType":"newapi-image","model":"zhenzhen-image-g-v2.5-lowprice"}}`
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	receipt := imageRecoveryTestReceipt(task)
	receipt.Path = "/v1/video/generations"
	receipt.ProviderRequestID = "task-async"
	receipt.ResponseBody = `{"task_id":"task-async","id":"task-async","status":"queued"}`
	if err := db.Create(&receipt).Error; err != nil {
		t.Fatal(err)
	}

	original := imageRecoveryGetJSON
	defer func() { imageRecoveryGetJSON = original }()
	imageRecoveryGetJSON = func(ctx context.Context, config generation.Config, path string, target interface{}) error {
		if path != "/v1/video/generations/task-async" {
			t.Fatalf("recovery queried unexpected path %q", path)
		}
		state := map[string]any{
			"code": "success",
			"data": map[string]any{
				"task_id": "task-async",
				"data": map[string]any{
					"id":     "task-async",
					"status": "succeeded",
					"content": map[string]any{
						"image_urls": []any{"https://8.8.8.8/recovered.png"},
					},
				},
			},
		}
		*target.(*map[string]any) = state
		return nil
	}

	restored, handled, err := s.recoverAcceptedImage(task)
	if err != nil || !handled || restored == nil || restored.Status != model.TaskStatusSucceeded {
		t.Fatalf("async recovery recovered=%+v handled=%v err=%v", restored, handled, err)
	}
	if restored.ProviderRequestID != "task-async" || !strings.Contains(restored.ResultJSON, "recovered.png") {
		t.Fatalf("async recovery result = %+v", restored)
	}
}

func TestAsyncImageRecoveryKeepsPendingTaskForLaterRetrieval(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	task := imageRecoveryTestTask()
	task.ProviderRequestID = "task-pending"
	task.InputJSON = `{"mode":"image","config":{"baseUrl":"https://example.com","apiKey":"test-key","interfaceType":"newapi-image","model":"image"}}`
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	receipt := imageRecoveryTestReceipt(task)
	receipt.Path = "/v1/video/generations"
	receipt.ProviderRequestID = "task-pending"
	receipt.ResponseBody = `{"task_id":"task-pending","id":"task-pending"}`
	if err := db.Create(&receipt).Error; err != nil {
		t.Fatal(err)
	}
	original := imageRecoveryGetJSON
	defer func() { imageRecoveryGetJSON = original }()
	imageRecoveryGetJSON = func(ctx context.Context, config generation.Config, path string, target interface{}) error {
		*target.(*map[string]any) = map[string]any{"data": map[string]any{"task_id": "task-pending", "status": "processing"}}
		return nil
	}
	if restored, handled, err := s.recoverAcceptedImage(task); !handled || restored != nil || err == nil {
		t.Fatalf("pending async task recovered=%+v handled=%v err=%v", restored, handled, err)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || stored.ProviderRequestID != "task-pending" {
		t.Fatalf("pending async task changed unexpectedly: %+v err=%v", stored, err)
	}
}
