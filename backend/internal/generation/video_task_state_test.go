package generation

import "testing"

func TestValidateVideoTaskStateUnwrapsEnvelope(t *testing.T) {
	state := map[string]interface{}{
		"code": 200,
		"data": map[string]interface{}{
			"id":     "task-1",
			"status": "succeeded",
			"video":  map[string]interface{}{"url": "https://example.test/v.mp4"},
		},
	}
	got, err := ValidateVideoTaskState("task-1", state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got["id"] != "task-1" || got["status"] != "succeeded" {
		t.Fatalf("envelope not unwrapped: %#v", got)
	}
}

func TestValidateVideoTaskStateRejectsForeignTask(t *testing.T) {
	cases := []map[string]interface{}{
		{"id": "other-task"},
		{"task_id": "other-task"},
		{"taskId": "other-task"},
		{"data": map[string]interface{}{"id": "other-task"}},
	}
	for _, state := range cases {
		if _, err := ValidateVideoTaskState("task-1", state); err == nil {
			t.Fatalf("foreign task id accepted: %#v", state)
		}
	}
}

func TestValidateVideoTaskStateKeepsProvidersWithoutTaskID(t *testing.T) {
	state := map[string]interface{}{"status": "succeeded", "video_url": "https://example.test/v.mp4"}
	got, err := ValidateVideoTaskState("task-1", state)
	if err != nil || got["status"] != "succeeded" {
		t.Fatalf("provider without task id must stay supported: %#v %v", got, err)
	}
}

func TestVideoTaskSucceededSpellings(t *testing.T) {
	for _, status := range []string{"completed", "succeeded", "success", "done", " SUCCEEDED "} {
		if !VideoTaskSucceeded(status) {
			t.Fatalf("%q should count as succeeded", status)
		}
	}
	for _, status := range []string{"", "running", "queued", "failed", "cancelled", "expired"} {
		if VideoTaskSucceeded(status) {
			t.Fatalf("%q must not count as succeeded", status)
		}
	}
}
