package canvas

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/repository"
)

const bindRevisionAttempts = 4

// TaskOutputBind is the generation-field overlay applied to an existing node.
// Title, position and unrelated metadata stay on the node.
type TaskOutputBind struct {
	// Set only by the transaction-bound composition root after local render ownership validation.
	AllowEmptyVideo bool `json:"-"`
	// Trusted admission identity for a pending video saved before the task response.
	PendingClientOperationID string `json:"-"`
	TaskType                 string `json:"-"`

	CanvasID    string
	NodeID      string
	TaskID      string
	OutputIndex int
	EffectKey   string
	MediaType   string
	// Prompt 由调用方从任务记录补上：节点被删除后按产物重建时，
	// 只有任务身份是拿不到提示词的，用户就再也看不到当时写的是什么。
	Prompt     string
	AssetID    string
	ResourceID string
	StorageKey string
	Content    string
	MimeType   string
	Bytes      int64
	Width      int
	Height     int
	DurationMs int64
	Storyboard map[string]any
}

// TaskOutputBindResult is the canvas write outcome after a generation bind.
type TaskOutputBindResult struct {
	Revision int64
	Node     map[string]any
}

// BindTaskOutputToExistingNode writes generation result fields onto the original
// node whose metadata.taskId still matches the task. 如果原节点已被删除，则按任务产物
// **重建**该节点（同一个 nodeId），避免用户已经付费的结果因为节点被删而永远取不回来。
func (s *Service) BindTaskOutputToExistingNode(userID string, patch TaskOutputBind) (TaskOutputBindResult, error) {
	var last error
	for attempt := 0; attempt < bindRevisionAttempts; attempt++ {
		result, err := s.bindTaskOutputOnce(userID, patch)
		if err == nil {
			return result, nil
		}
		last = err
		if !isCanvasRevisionConflict(err) {
			return TaskOutputBindResult{}, err
		}
	}
	if last == nil {
		last = canvasRevisionConflict()
	}
	return TaskOutputBindResult{}, last
}

func (s *Service) bindTaskOutputOnce(userID string, patch TaskOutputBind) (TaskOutputBindResult, error) {
	if strings.TrimSpace(patch.CanvasID) == "" || strings.TrimSpace(patch.NodeID) == "" || strings.TrimSpace(patch.TaskID) == "" {
		return TaskOutputBindResult{}, kernel.NewAppError(http.StatusBadRequest, "绑定缺少画布、节点或任务身份")
	}
	doc, err := s.loadCanvasDoc(userID, patch.CanvasID)
	if err != nil {
		return TaskOutputBindResult{}, err
	}
	node, recreated := ensureBindableNode(doc, patch)
	if recreated {
		log.Printf("[canvas-bind] 原节点已删除，按任务产物重建节点 task=%s node=%s", patch.TaskID, patch.NodeID)
	}
	if got := nodeString(nodeMetadata(node), "taskId"); got != strings.TrimSpace(patch.TaskID) && !canBindEmptyRenderNode(node, patch) && !canBindPendingVideoNode(node, patch) {
		message := "节点已绑定到其他任务，未覆盖该节点"
		if got == "" {
			message = "节点尚未关联这次任务，生成结果已保留"
		}
		return TaskOutputBindResult{}, &kernel.AppError{
			Status: http.StatusConflict, Reason: kernel.ErrorReason("node_task_mismatch"),
			Message: message,
		}
	}
	metadata := nodeMetadata(node)
	if alreadyBound(metadata, patch) {
		return TaskOutputBindResult{Revision: canvasRevisionValue(doc), Node: cloneNode(node)}, nil
	}
	applyGenerationBindMetadata(metadata, patch)
	node["metadata"] = metadata
	expected := canvasRevisionValue(doc)
	if expected <= 0 {
		expected = 1
	}
	summary, err := s.saveCanvasDocWithRevision(userID, patch.CanvasID, doc, expected)
	if err != nil {
		return TaskOutputBindResult{}, err
	}
	return TaskOutputBindResult{Revision: summary.Revision, Node: cloneNode(node)}, nil
}

func canBindPendingVideoNode(node map[string]any, patch TaskOutputBind) bool {
	metadata := nodeMetadata(node)
	if patch.PendingClientOperationID == "" || nodeString(metadata, "taskClientOperationId") != patch.PendingClientOperationID {
		return false
	}
	// The same empty-media guard also rejects a node assigned to another task.
	patch.AllowEmptyVideo = true
	return canBindEmptyRenderNode(node, patch)
}

func canBindEmptyRenderNode(node map[string]any, patch TaskOutputBind) bool {
	if !patch.AllowEmptyVideo || patch.MediaType != "video" || nodeString(node, "type") != "video" {
		return false
	}
	metadata := nodeMetadata(node)
	for _, fields := range []map[string]any{node, metadata} {
		for _, key := range []string{"taskId", "content", "storageKey", "assetId", "resourceId", "url", "dataUrl"} {
			if value, exists := fields[key]; exists && value != nil {
				if text, ok := value.(string); !ok || text != "" {
					return false
				}
			}
		}
	}
	return true
}

func alreadyBound(metadata map[string]any, patch TaskOutputBind) bool {
	if strings.TrimSpace(patch.EffectKey) != "" && !effectKeyPresent(metadata, patch.EffectKey) {
		return false
	}
	if patch.AssetID != "" && nodeString(metadata, "assetId") != patch.AssetID {
		return false
	}
	if patch.StorageKey != "" && nodeString(metadata, "storageKey") != patch.StorageKey {
		return false
	}
	if patch.Content != "" && nodeString(metadata, "content") != patch.Content {
		return false
	}
	if patch.Storyboard != nil && nodeString(metadata, "status") != "success" {
		return false
	}
	return nodeString(metadata, "status") == "success" && nodeString(metadata, "taskId") == strings.TrimSpace(patch.TaskID)
}

func applyGenerationBindMetadata(metadata map[string]any, patch TaskOutputBind) {
	// Preparation keeps the previous video playable. Its previews and measured
	// properties belong to that media, so replace them only when the new output binds.
	if patch.MediaType == "video" && ((patch.StorageKey != "" && patch.StorageKey != nodeString(metadata, "storageKey")) ||
		(patch.Content != "" && patch.Content != nodeString(metadata, "content"))) {
		for _, key := range []string{"previewContent", "videoPreview", "naturalWidth", "naturalHeight", "durationMs", "hasAudio", "bytes", "mimeType", "outputParameterWarning"} {
			delete(metadata, key)
		}
	}
	if patch.Content != "" {
		metadata["content"] = patch.Content
	}
	if patch.StorageKey != "" {
		metadata["storageKey"] = patch.StorageKey
	}
	if patch.AssetID != "" {
		metadata["assetId"] = patch.AssetID
	}
	if patch.MimeType != "" {
		metadata["mimeType"] = patch.MimeType
	}
	if patch.Bytes > 0 {
		metadata["bytes"] = patch.Bytes
	}
	if patch.Width > 0 {
		metadata["naturalWidth"] = patch.Width
	}
	if patch.Height > 0 {
		metadata["naturalHeight"] = patch.Height
	}
	if patch.DurationMs > 0 {
		metadata["durationMs"] = patch.DurationMs
	}
	if patch.MediaType != "" && patch.MediaType != "text" {
		metadata["nodeRole"] = "result"
		metadata["resultOrigin"] = "generated"
	}
	if patch.Storyboard != nil {
		existing, _ := metadata["storyboard"].(map[string]any)
		next := map[string]any{}
		for key, value := range existing {
			next[key] = value
		}
		for key, value := range patch.Storyboard {
			next[key] = value
		}
		metadata["storyboard"] = next
	}
	metadata["status"] = "success"
	metadata["taskId"] = patch.TaskID
	if patch.TaskType != "" {
		metadata["taskType"] = patch.TaskType
	}
	metadata["taskStatus"] = "succeeded"
	metadata["taskProgress"] = 100
	metadata["errorDetails"] = nil
	metadata["generationErrorCode"] = nil
	metadata["resourceReloadAvailable"] = nil
	metadata["failedPromptFingerprint"] = nil
	metadata["failedInputFingerprint"] = nil
	if strings.TrimSpace(patch.EffectKey) != "" {
		metadata["generationEffectKeys"] = appendEffectKey(metadata["generationEffectKeys"], patch.EffectKey)
	}
}

// ensureBindableNode 找到目标节点；已被删除时按产物类型重建一个同 id 的节点。
// 重建节点只带任务身份与占位尺寸，真实的媒体字段由随后的 bind 覆盖。
func ensureBindableNode(doc map[string]any, patch TaskOutputBind) (map[string]any, bool) {
	if node := findCanvasNode(doc, patch.NodeID); node != nil {
		return node, false
	}
	kind := strings.TrimSpace(patch.MediaType)
	if kind != "video" && kind != "audio" {
		kind = "image"
	}
	width, height := patch.Width, patch.Height
	if width <= 0 || width > 2048 {
		width = 320
	}
	if height <= 0 || height > 2048 {
		height = 320
	}
	node := map[string]any{
		"id":       strings.TrimSpace(patch.NodeID),
		"type":     kind,
		"title":    "恢复的生成结果",
		"position": map[string]any{"x": nextCanvasNodeX(doc), "y": 120},
		"width":    width,
		"height":   height,
		"metadata": restoredNodeMetadata(patch),
	}
	nodes, _ := doc["nodes"].([]any)
	doc["nodes"] = append(nodes, node)
	return node, true
}

// restoredNodeMetadata 给重建节点带上任务身份，并尽量还原提示词，
// 否则用户只看到一张图，不知道当时让它做什么。
func restoredNodeMetadata(patch TaskOutputBind) map[string]any {
	metadata := map[string]any{
		"taskId":           strings.TrimSpace(patch.TaskID),
		"status":           "loading",
		"restoredFromTask": true,
	}
	if prompt := strings.TrimSpace(patch.Prompt); prompt != "" {
		metadata["composerContent"] = prompt
		metadata["prompt"] = prompt
	}
	return metadata
}

// nextCanvasNodeX 把重建的节点放到现有内容右侧的空位，不去猜原来的位置。
func nextCanvasNodeX(doc map[string]any) float64 {
	nodes, _ := doc["nodes"].([]any)
	right := 120.0
	for _, raw := range nodes {
		node, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		position, ok := node["position"].(map[string]any)
		if !ok {
			continue
		}
		x, _ := position["x"].(float64)
		width, _ := node["width"].(float64)
		if x+width > right {
			right = x + width
		}
	}
	return right + 96
}

func nodeMetadata(node map[string]any) map[string]any {
	if node == nil {
		return map[string]any{}
	}
	switch typed := node["metadata"].(type) {
	case map[string]any:
		out := make(map[string]any, len(typed)+8)
		for key, value := range typed {
			out[key] = value
		}
		return out
	case json.RawMessage:
		var out map[string]any
		if json.Unmarshal(typed, &out) == nil && out != nil {
			return out
		}
	}
	return map[string]any{}
}

func nodeString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, _ := metadata[key].(string)
	return strings.TrimSpace(value)
}

func effectKeyPresent(metadata map[string]any, effectKey string) bool {
	for _, item := range effectKeyList(metadata["generationEffectKeys"]) {
		if item == effectKey {
			return true
		}
	}
	return false
}

func appendEffectKey(existing any, effectKey string) []any {
	out := effectKeyList(existing)
	for _, item := range out {
		if item == effectKey {
			return existingToAny(out)
		}
	}
	out = append(out, effectKey)
	return existingToAny(out)
}

func effectKeyList(existing any) []string {
	switch typed := existing.(type) {
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				out = append(out, text)
			}
		}
		return out
	case []string:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if strings.TrimSpace(item) != "" {
				out = append(out, item)
			}
		}
		return out
	default:
		return nil
	}
}

func existingToAny(items []string) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func cloneNode(node map[string]any) map[string]any {
	if node == nil {
		return nil
	}
	encoded, err := json.Marshal(node)
	if err != nil {
		out := make(map[string]any, len(node))
		for key, value := range node {
			out[key] = value
		}
		return out
	}
	var out map[string]any
	if json.Unmarshal(encoded, &out) != nil {
		return node
	}
	return out
}

func canvasRevisionValue(doc map[string]any) int64 {
	switch typed := doc["revision"].(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	case json.Number:
		n, err := typed.Int64()
		if err == nil {
			return n
		}
	}
	return 0
}

func isCanvasRevisionConflict(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, repository.ErrCanvasRevisionConflict) {
		return true
	}
	var appErr *kernel.AppError
	if errors.As(err, &appErr) && appErr.Status == http.StatusConflict {
		return strings.Contains(appErr.Message, "已有更新") || strings.Contains(strings.ToLower(appErr.Message), "revision")
	}
	return false
}
