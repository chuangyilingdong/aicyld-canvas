package operations

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

type taskWaitProbe struct {
	unusedDomain
	tasks map[string]*model.Task
	doc   json.RawMessage
}

func (p *taskWaitProbe) Task(_ string, id string) (*model.Task, error) {
	return p.tasks[id], nil
}

func (p *taskWaitProbe) UserCanvasProject(_ string, _ string) (json.RawMessage, error) {
	return p.doc, nil
}

func TestTaskWaitReturnsCompletedTaskAndBinding(t *testing.T) {
	probe := &taskWaitProbe{tasks: map[string]*model.Task{
		"task-1": {ID: "task-1", Type: "canvas_image", Status: model.TaskStatusSucceeded, ResultState: "READY",
			Outputs: []model.TaskOutput{{OutputIndex: 0, ResourceID: "res-1", MaterializedAssetID: "asset-1"}}},
	}, doc: json.RawMessage(`{"revision":7,"nodes":[{"id":"node-1","type":"image","metadata":{"taskId":"task-1","status":"success","storageKey":"resource:res-1"}}]}`)}
	raw, _ := json.Marshal(map[string]any{"taskId": "task-1", "canvasId": "canvas-1", "nodeId": "node-1", "timeoutMs": 50})
	value, err := opTaskWait(&Context{UserID: "owner", Domain: probe}, raw)
	if err != nil {
		t.Fatal(err)
	}
	result := value.(map[string]any)
	if result["pending"] != false || len(result["completedTaskIds"].([]string)) != 1 {
		t.Fatalf("unexpected completed result: %#v", result)
	}
	binding := result["binding"].(map[string]any)
	if binding["bound"] != true || binding["revision"] != int64(7) {
		t.Fatalf("unexpected binding: %#v", binding)
	}
}

func TestTaskWaitTimesOutPendingWithoutError(t *testing.T) {
	probe := &taskWaitProbe{tasks: map[string]*model.Task{
		"task-1": {ID: "task-1", Status: model.TaskStatusRunning},
	}}
	raw, _ := json.Marshal(map[string]any{"taskIds": []string{"task-1"}, "timeoutMs": 50})
	started := time.Now()
	value, err := opTaskWait(&Context{UserID: "owner", Domain: probe, Context: t.Context()}, raw)
	if err != nil {
		t.Fatal(err)
	}
	result := value.(map[string]any)
	if result["pending"] != true || result["timedOut"] != true {
		t.Fatalf("expected pending timeout: %#v", result)
	}
	if time.Since(started) < 40*time.Millisecond {
		t.Fatal("task.wait returned before its timeout")
	}
}

func TestTaskWaitDistinguishesMissingTaskFromPending(t *testing.T) {
	probe := &taskWaitProbe{tasks: map[string]*model.Task{}}
	raw, _ := json.Marshal(map[string]any{"taskId": "missing", "timeoutMs": 50})
	_, err := opTaskWait(&Context{UserID: "owner", Domain: probe, Context: t.Context()}, raw)
	var opErr *Error
	if !errors.As(err, &opErr) || opErr.Code != CodeNotFound || opErr.Reason != "task_not_found" {
		t.Fatalf("expected task_not_found, got %v", err)
	}
}

func TestTaskWaitClassifiesSavingAndMaterializationFailure(t *testing.T) {
	saving := &model.Task{Status: model.TaskStatusSucceeded, ResultState: "PENDING_MATERIALIZATION"}
	state, terminal := taskWaitState(saving)
	if state != "saving" || terminal {
		t.Fatalf("saving state = %s terminal=%v", state, terminal)
	}
	failed := &model.Task{Status: model.TaskStatusSucceeded, ResultState: "FAILED_PERMANENT"}
	state, terminal = taskWaitState(failed)
	if state != "failed_materialization" || !terminal {
		t.Fatalf("failure state = %s terminal=%v", state, terminal)
	}
}
