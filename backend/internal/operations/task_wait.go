package operations

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

const (
	taskWaitDefaultTimeout = 5 * time.Second
	taskWaitMaxTimeout     = 25 * time.Second
	taskWaitMinTimeout     = 50 * time.Millisecond
	taskWaitPollInterval   = 250 * time.Millisecond
)

func registerTaskWaitOp(r *Registry) {
	r.Register(Op{ExternalOnly: true, ID: "task.wait", Summary: "短时等待最多 8 个任务进入可交付或终态；超时返回 pending，不重复提交任务", ReadOnly: true, Scope: ScopeWorkspaceRead,
		Params: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"taskId":{"type":"string"},"taskIds":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":8},"canvasId":{"type":"string","description":"可选；与 nodeId 一起检查产物是否已绑定目标节点"},"nodeId":{"type":"string","description":"可选；与 canvasId 一起检查产物是否已绑定目标节点"},"timeoutMs":{"type":"integer","minimum":50,"maximum":25000,"default":5000}}`),
		Handler: opTaskWait})
}

func opTaskWait(ctx *Context, raw json.RawMessage) (any, error) {
	var args struct {
		TaskID    string   `json:"taskId"`
		TaskIDs   []string `json:"taskIds"`
		CanvasID  string   `json:"canvasId"`
		NodeID    string   `json:"nodeId"`
		TimeoutMS int64    `json:"timeoutMs"`
	}
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	taskIDs, err := uniqueTaskWaitIDs(args.TaskID, args.TaskIDs)
	if err != nil {
		return nil, err
	}
	canvasID := strings.TrimSpace(args.CanvasID)
	nodeID := strings.TrimSpace(args.NodeID)
	if (canvasID == "") != (nodeID == "") {
		return nil, InvalidArg("invalid_params", "canvasId 与 nodeId 必须同时提供或同时省略")
	}
	timeout := taskWaitDefaultTimeout
	if args.TimeoutMS > 0 {
		timeout = time.Duration(args.TimeoutMS) * time.Millisecond
	}
	if timeout < taskWaitMinTimeout || timeout > taskWaitMaxTimeout {
		return nil, InvalidArg("invalid_params", "timeoutMs 必须在 50–25000 之间")
	}

	deadline := time.Now().Add(timeout)
	for {
		observation, err := observeWaitingTasks(ctx, taskIDs, canvasID, nodeID)
		if err != nil {
			return nil, err
		}
		remaining := time.Until(deadline)
		pending, _ := observation["pending"].(bool)
		if !pending || remaining <= 0 {
			observation["timedOut"] = pending && remaining <= 0
			return observation, nil
		}
		delay := taskWaitPollInterval
		if remaining < delay {
			delay = remaining
		}
		if err := waitTaskPoll(ctx.Context, delay); err != nil {
			return nil, AsError(err)
		}
	}
}

func uniqueTaskWaitIDs(single string, values []string) ([]string, error) {
	all := make([]string, 0, len(values)+1)
	if strings.TrimSpace(single) != "" {
		all = append(all, single)
	}
	all = append(all, values...)
	if len(all) == 0 {
		return nil, InvalidArg("invalid_params", "taskId 与 taskIds 至少提供一个")
	}
	seen := make(map[string]bool, len(all))
	result := make([]string, 0, len(all))
	for _, value := range all {
		id := strings.TrimSpace(value)
		if id == "" || len(id) > 80 {
			return nil, InvalidArg("invalid_params", "任务 ID 无效")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	if len(result) > 8 {
		return nil, InvalidArg("invalid_params", "一次最多等待 8 个任务")
	}
	return result, nil
}

func observeWaitingTasks(ctx *Context, taskIDs []string, canvasID, nodeID string) (map[string]any, error) {
	tasks := make([]map[string]any, 0, len(taskIDs))
	failedTaskIDs := make([]string, 0)
	completedTaskIDs := make([]string, 0)
	missingTaskIDs := make([]string, 0)
	allTerminal := true
	for _, taskID := range taskIDs {
		task, err := ctx.Domain.Task(ctx.UserID, taskID)
		if err != nil {
			return nil, mapDomainError(err)
		}
		if task == nil {
			missingTaskIDs = append(missingTaskIDs, taskID)
			allTerminal = false
			continue
		}
		state, terminal := taskWaitState(task)
		projection := taskWaitProjection(task, state, terminal)
		tasks = append(tasks, projection)
		if !terminal {
			allTerminal = false
		}
		if state == "completed" {
			completedTaskIDs = append(completedTaskIDs, taskID)
		} else if terminal {
			failedTaskIDs = append(failedTaskIDs, taskID)
		}
	}
	if len(missingTaskIDs) > 0 {
		return nil, newError(CodeNotFound, "task_not_found", "部分任务不存在", map[string]any{"taskIds": missingTaskIDs})
	}

	result := map[string]any{
		"taskIds": taskIDs, "tasks": tasks, "pending": !allTerminal,
		"failedTaskIds": failedTaskIDs, "completedTaskIds": completedTaskIDs,
	}
	if canvasID != "" {
		binding, err := taskWaitBinding(ctx, canvasID, nodeID, taskIDs)
		if err != nil {
			return nil, err
		}
		result["binding"] = binding
		if allTerminal && len(failedTaskIDs) == 0 && binding["bound"] != true {
			result["pending"] = true
		}
	}
	return result, nil
}

func taskWaitState(task *model.Task) (string, bool) {
	if task == nil {
		return "missing", true
	}
	switch task.Status {
	case model.TaskStatusQueued:
		return "queued", false
	case model.TaskStatusRunning:
		return "running", false
	case model.TaskStatusCancelled:
		return "cancelled", true
	case model.TaskStatusFailed:
		if phase := taskOutcomePhase(task); phase == "retrievable" || phase == "fetching" || phase == "running" {
			return "downloading", false
		}
		return "failed", true
	case model.TaskStatusSucceeded:
		state := strings.ToLower(strings.TrimSpace(task.ResultState))
		if state == "failed_retryable" || state == "failed_permanent" {
			return "failed_materialization", true
		}
		if state == "ready" {
			return "completed", true
		}
		if phase := taskOutcomePhase(task); phase == "ready" {
			return "completed", true
		}
		if task.Delivery != nil {
			for _, output := range task.Delivery.Outputs {
				switch output.State {
				case "downloading", "retrying", "waiting":
					return "downloading", false
				}
			}
		}
		if state == "" && len(task.Outputs) == 0 {
			return "completed", true
		}
		return "saving", false
	default:
		return string(task.Status), true
	}
}

func taskWaitProjection(task *model.Task, state string, terminal bool) map[string]any {
	projection := map[string]any{
		"taskId": task.ID, "type": task.Type, "status": task.Status, "state": state,
		"terminal": terminal, "progress": task.Progress, "outputs": task.Outputs,
		"resultState": task.ResultState, "delivery": task.Delivery,
		"createdAt": task.CreatedAt, "updatedAt": task.UpdatedAt,
	}
	if task.Error != "" {
		projection["error"] = task.Error
	}
	if task.Outcome != nil {
		projection["outcome"] = task.Outcome
	}
	return projection
}

func taskOutcomePhase(task *model.Task) string {
	if task == nil || task.Outcome == nil {
		return ""
	}
	return strings.TrimSpace(task.Outcome.Phase)
}

func taskWaitBinding(ctx *Context, canvasID, nodeID string, taskIDs []string) (map[string]any, error) {
	raw, err := ctx.Domain.UserCanvasProject(ctx.UserID, canvasID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, AsError(err)
	}
	node := findDocNode(doc, nodeID)
	result := map[string]any{"canvasId": canvasID, "nodeId": nodeID, "nodeFound": node != nil, "bound": false, "revision": canvasRevision(doc)}
	if node == nil {
		return result, nil
	}
	metadata, _ := node["metadata"].(map[string]any)
	taskID, _ := metadata["taskId"].(string)
	storageKey, _ := metadata["storageKey"].(string)
	status, _ := metadata["status"].(string)
	phase := ""
	if outcome, ok := metadata["taskOutcome"].(map[string]any); ok {
		phase, _ = outcome["phase"].(string)
	}
	result["taskId"] = taskID
	result["bound"] = containsTaskID(taskIDs, strings.TrimSpace(taskID)) && status == "success" &&
		strings.HasPrefix(storageKey, "resource:") && (phase == "" || phase == "ready")
	result["node"] = sanitizeForClient(node)
	return result, nil
}

func containsTaskID(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func waitTaskPoll(ctx context.Context, delay time.Duration) error {
	if ctx == nil {
		ctx = context.Background()
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
