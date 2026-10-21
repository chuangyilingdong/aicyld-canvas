package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
)

var imageRecoveryGetJSON = generation.GetJSON

// recoverAcceptedImage restores a failed image task from the original provider
// task. It never sends another paid create request.
func (s *Service) recoverAcceptedImage(task model.Task) (*model.Task, bool, error) {
	if task.Type != "canvas_image" || task.Status != model.TaskStatusFailed {
		return nil, false, nil
	}
	receipt, err := s.repo.ImageCreateReceipt(task.UserID, task.ID)
	if err != nil {
		return nil, true, imageRecoveryError{err}
	}
	if receipt != nil && (receipt.StatusCode < 200 || (receipt.StatusCode >= 200 && receipt.StatusCode < 300 && (receipt.StatusCode != 200 || receipt.Status != model.ApiCallStatusSucceeded || receipt.APIFormat != "openai"))) {
		return nil, true, imageRecoveryError{errors.New("创建请求结果未知")}
	}
	if receipt == nil || receipt.StatusCode < 200 || receipt.StatusCode >= 300 {
		return nil, false, nil
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(receipt.ResponseBody), &payload); err != nil {
		return nil, true, imageRecoveryError{err}
	}
	if _, _, failed := generation.PayloadBusinessFailure(payload); failed {
		return nil, false, nil
	}

	syncImages := imageCreateReceiptURLs(payload)
	taskID := firstNonEmpty(receipt.ProviderRequestID, task.ProviderRequestID, imageTaskIDFromPayload(payload))
	asyncImage := len(syncImages) == 0 && taskID != "" && isImageTaskCreatePath(receipt.Path)
	if len(syncImages) == 0 && !asyncImage {
		return nil, true, imageRecoveryError{errors.New("成功回执缺少完整图片结果")}
	}

	owner := "manual-recovery:" + newID()
	if err := s.repo.ClaimFailedTaskProviderRecovery(task.ID, task.UserID, owner, providerTaskRecoveryLeaseDuration); err != nil {
		return nil, true, err
	}
	task.LeaseOwner = owner
	defer s.repo.ReleaseTaskProviderRecovery(task.ID, owner)

	images := make([]map[string]any, 0, len(syncImages))
	if asyncImage {
		task.ProviderRequestID = taskID
		if err := s.repo.UpdateTaskProviderState(task.ID, taskID, task.PollStage, task.NextPollAt); err != nil {
			return nil, true, err
		}
		images, err = s.queryAcceptedAsyncImage(&task, receipt.Path, taskID)
		if err != nil {
			return nil, true, err
		}
	} else {
		for _, imageURL := range syncImages {
			if _, err := outbound.ValidateOutboundURL(imageURL); err != nil {
				return nil, true, err
			}
			images = append(images, map[string]any{"url": imageURL})
		}
	}

	result, err := json.Marshal(map[string]any{"mode": "image", "images": images})
	if err != nil {
		return nil, true, err
	}
	task.Error = ""
	if task.FailureDiagnostics != nil {
		task.FailureDiagnostics.ExecutionResult = "completed"
	}
	if err := s.saveTaskCompletionWithinStorageQuota(&task, result, nil, false); err != nil {
		return nil, true, err
	}
	_ = s.log(task.UserID, task.ID, "info", "已从原始任务恢复图片，等待取回结果", receipt.ID)
	s.attachTaskDelivery(&task)
	return taskForOutput(task), true, nil
}

func imageCreateReceiptURLs(payload map[string]any) []string {
	data, _ := payload["data"].([]any)
	urls := make([]string, 0, len(data))
	for _, item := range data {
		entry, _ := item.(map[string]any)
		if imageURL := strings.TrimSpace(stringField(entry, "url")); imageURL != "" {
			urls = append(urls, imageURL)
		}
	}
	return urls
}

func imageTaskIDFromPayload(payload map[string]any) string {
	return firstNonEmpty(stringField(payload, "task_id"), stringField(payload, "taskId"), stringField(payload, "id"))
}

func isImageTaskCreatePath(path string) bool {
	path = strings.TrimRight(strings.TrimSpace(path), "/")
	for _, suffix := range []string{"/images/generations", "/images/edits", "/video/generations"} {
		if strings.HasSuffix(path, suffix) {
			return true
		}
	}
	return false
}

func (s *Service) queryAcceptedAsyncImage(task *model.Task, createPath string, taskID string) ([]map[string]any, error) {
	decryptedInput, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, imageRecoveryError{err}
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(decryptedInput), &input); err != nil {
		return nil, imageRecoveryError{err}
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, imageRecoveryError{err}
	}
	task.InputJSON = decryptedInput
	recoveryCtx, cancel := providerTaskRecoveryContext(context.Background())
	defer cancel()
	queryCtx := withProviderAnalytics(recoveryCtx, s, *task)
	pollPath := strings.TrimRight(createPath, "/") + "/" + url.PathEscape(taskID)
	var state map[string]any
	if err := imageRecoveryGetJSON(queryCtx, config, pollPath, &state); err != nil {
		return nil, err
	}
	if _, err := generation.ValidateVideoTaskState(taskID, state); err != nil {
		return nil, imageRecoveryError{err}
	}
	status, urls, reason := imageTaskResultFromState(state)
	if status == "failed" || status == "cancelled" || status == "expired" {
		return nil, BadAuthRequest("上游原图片任务已失败：" + defaultString(reason, "请调整输入后重新生成"))
	}
	if !generation.VideoTaskSucceeded(status) {
		return nil, imageRecoveryError{errors.New("原图片任务仍在上游处理中，请稍后再次点击「继续取回」")}
	}
	if len(urls) == 0 {
		return nil, imageRecoveryError{errors.New("上游图片任务成功但没有返回可用图片")}
	}
	images := make([]map[string]any, 0, len(urls))
	for _, imageURL := range urls {
		if _, err := outbound.ValidateOutboundURL(imageURL); err != nil {
			return nil, imageRecoveryError{err}
		}
		images = append(images, map[string]any{"url": imageURL})
	}
	return images, nil
}

// imageTaskResultFromState handles both the async image envelope and direct
// result shapes. Reference requests are stored as strings, so only actual URL
// fields are collected from maps.
func imageTaskResultFromState(state map[string]any) (string, []string, string) {
	statuses := make([]string, 0)
	urls := make([]string, 0)
	reasons := make([]string, 0)
	collectImageTaskState(state, false, &statuses, &urls, &reasons)
	status := bestImageTaskStatus(statuses)
	return status, uniqueStrings(urls), defaultString(firstNonEmpty(reasons...), "")
}

func collectImageTaskState(value any, inResults bool, statuses *[]string, urls *[]string, reasons *[]string) {
	switch current := value.(type) {
	case map[string]any:
		if status := strings.TrimSpace(stringField(current, "status")); status != "" {
			*statuses = append(*statuses, status)
		}
		if reason := strings.TrimSpace(stringField(current, "fail_reason")); reason != "" {
			*reasons = append(*reasons, reason)
		}
		if nestedError, ok := current["error"].(map[string]any); ok {
			if message := strings.TrimSpace(stringField(nestedError, "message")); message != "" {
				*reasons = append(*reasons, message)
			}
		}
		for _, key := range []string{"image_url", "result_url"} {
			if imageURL := strings.TrimSpace(stringField(current, key)); imageURL != "" {
				*urls = append(*urls, imageURL)
			}
		}
		for _, key := range []string{"image_urls", "urls"} {
			if items, ok := current[key].([]any); ok {
				for _, item := range items {
					if imageURL, ok := item.(string); ok && strings.TrimSpace(imageURL) != "" {
						*urls = append(*urls, imageURL)
					}
				}
			}
		}
		if inResults {
			if imageURL := strings.TrimSpace(stringField(current, "url")); imageURL != "" {
				*urls = append(*urls, imageURL)
			}
		}
		for key, nested := range current {
			collectImageTaskState(nested, inResults || key == "results", statuses, urls, reasons)
		}
	case []any:
		for _, item := range current {
			collectImageTaskState(item, inResults, statuses, urls, reasons)
		}
	}
}

func bestImageTaskStatus(statuses []string) string {
	best, priority := "", -1
	for _, status := range statuses {
		current := imageTaskStatusPriority(status)
		if current > priority {
			best, priority = status, current
		}
	}
	return strings.ToLower(strings.TrimSpace(best))
}

func imageTaskStatusPriority(status string) int {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "succeeded", "completed", "success", "done":
		return 4
	case "failed", "cancelled", "canceled", "expired":
		return 3
	case "running", "processing", "in_progress":
		return 2
	case "queued", "pending", "not_start", "submitted":
		return 1
	default:
		return 0
	}
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
