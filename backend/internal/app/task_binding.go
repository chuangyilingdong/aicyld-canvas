package app

import (
	"encoding/json"
	"errors"
	"log"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/operations"
	localtask "infinite-canvas/backend/internal/task"
)

const canvasBindRecoveryBatch = 64

func (s *Service) workspaceOperations() *operations.Registry {
	if s == nil || s.repo == nil {
		return nil
	}
	s.workspaceOpsMu.Lock()
	defer s.workspaceOpsMu.Unlock()
	if s.workspaceOps != nil {
		return s.workspaceOps
	}
	db := s.Database()
	if db == nil {
		return nil
	}
	registry := operations.NewRegistry(s, operations.NewStore(db))
	operations.RegisterDefaultOps(registry)
	s.workspaceOps = registry
	return registry
}

func (s *Service) recoverCanvasTaskBindings(task model.Task) error {
	if s == nil || strings.TrimSpace(task.ID) == "" || strings.TrimSpace(task.UserID) == "" {
		return nil
	}
	if task.Status != model.TaskStatusSucceeded {
		return nil
	}
	registry := s.workspaceOperations()
	intents := s.CanvasBindingIntents(task)
	var last error
	if registry != nil {
		for _, target := range canvasBindTargets(task, intents) {
			if err := s.executeCanvasTaskBind(registry, task, target.nodeID, target.outputIndex); err != nil {
				if skippableCanvasBindError(err) {
					continue
				}
				last = err
			}
		}
		for _, target := range messageBindTargets(task, intents) {
			if err := s.executeMessageTaskAttach(registry, task, target.conversationID, target.messageID, target.outputIndex); err != nil {
				if skippableCanvasBindError(err) {
					continue
				}
				last = err
			}
		}
	}
	if err := s.RegisterTaskOutputFromTask(task); err != nil {
		last = err
	}
	if projectID := strings.TrimSpace(task.ProjectID); projectID != "" {
		s.reconcileCharacterTurnaroundTasks(task.UserID, projectID)
	}
	return last
}

func (s *Service) recoverPendingCanvasBindings(limit int) error {
	if s == nil || s.repo == nil {
		return nil
	}
	if s.workspaceOperations() == nil {
		return nil
	}
	if limit <= 0 {
		limit = canvasBindRecoveryBatch
	}
	s.bindCursorMu.Lock()
	afterID := s.bindAfterID
	s.bindCursorMu.Unlock()
	tasks, err := s.repo.SucceededTasksForDelivery(afterID, limit)
	if err != nil {
		if bindInfrastructureUnavailable(err) {
			return nil
		}
		return err
	}
	if len(tasks) == 0 && afterID != "" {
		tasks, err = s.repo.SucceededTasksForDelivery("", limit)
		if err != nil {
			if bindInfrastructureUnavailable(err) {
				return nil
			}
			return err
		}
	}
	s.bindCursorMu.Lock()
	if len(tasks) == 0 || len(tasks) < limit {
		s.bindAfterID = ""
	} else {
		s.bindAfterID = tasks[len(tasks)-1].ID
	}
	s.bindCursorMu.Unlock()
	var last error
	for _, task := range tasks {
		if s.canvasBindSettled(task.ID) {
			continue
		}
		err := s.recoverCanvasTaskBindings(task)
		if err == nil {
			// 成功、或全部绑定都因永久原因被跳过：本进程内不必再看它一眼。
			s.markCanvasBindSettled(task.ID)
			continue
		}
		last = err
	}
	return last
}

// canvasBindSettled / markCanvasBindSettled 是 recovery 的进程内「已处理」标记。
// 没有它时 SucceededTasksForDelivery 每 5 秒会把所有 succeeded 任务重放一遍：实测每轮 14 个
// canvas.task.bind 全部重放，产生 280 次 agent_op_records UNIQUE 冲突 + 260 次画布查询日志
// （其中一半还是已删画布）。重启后重放一轮是有意保留的自愈行为。
func (s *Service) canvasBindSettled(taskID string) bool {
	key := strings.TrimSpace(taskID)
	if s == nil || key == "" {
		return false
	}
	s.bindSettledMu.Lock()
	defer s.bindSettledMu.Unlock()
	_, ok := s.bindSettled[key]
	return ok
}

func (s *Service) markCanvasBindSettled(taskID string) {
	key := strings.TrimSpace(taskID)
	if s == nil || key == "" {
		return
	}
	s.bindSettledMu.Lock()
	if s.bindSettled == nil {
		s.bindSettled = make(map[string]struct{})
	}
	s.bindSettled[key] = struct{}{}
	s.bindSettledMu.Unlock()
}

func (s *Service) executeMessageTaskAttach(registry *operations.Registry, task model.Task, conversationID, messageID string, outputIndex int) error {
	conversationID = strings.TrimSpace(conversationID)
	messageID = strings.TrimSpace(messageID)
	if registry == nil || conversationID == "" || messageID == "" {
		return nil
	}
	params, err := json.Marshal(map[string]any{
		"conversationId": conversationID,
		"taskId":         task.ID,
		"messageId":      messageID,
		"outputIndex":    outputIndex,
	})
	if err != nil {
		return err
	}
	bindOpID := localtask.AttachMessageEffectKey(task.ID, messageID, outputIndex)
	_, err = registry.Execute(operations.Request{
		Op:     "conversation.message.attach",
		OpID:   bindOpID,
		UserID: task.UserID,
		Caller: operations.ManualCaller(false),
		Params: params,
	})
	if skippableCanvasBindError(err) {
		s.noteSkippedCanvasBind(bindOpID, err)
		return nil
	}
	return err
}

func (s *Service) executeCanvasTaskBind(registry *operations.Registry, task model.Task, nodeID string, outputIndex int) error {
	canvasID := strings.TrimSpace(task.ProjectID)
	nodeID = strings.TrimSpace(nodeID)
	if registry == nil || canvasID == "" || nodeID == "" {
		return nil
	}
	params, err := json.Marshal(map[string]any{
		"canvasId":    canvasID,
		"taskId":      task.ID,
		"nodeId":      nodeID,
		"outputIndex": outputIndex,
	})
	if err != nil {
		return err
	}
	bindOpID := localtask.AttachNodeEffectKey(task.ID, nodeID, outputIndex)
	_, err = registry.Execute(operations.Request{
		Op:     "canvas.task.bind",
		OpID:   bindOpID,
		UserID: task.UserID,
		Caller: operations.ManualCaller(false),
		Params: params,
	})
	if skippableCanvasBindError(err) {
		s.noteSkippedCanvasBind(bindOpID, err)
		return nil
	}
	return err
}

type canvasBindTarget struct {
	nodeID      string
	outputIndex int
}

type messageBindTarget struct {
	conversationID string
	messageID      string
	outputIndex    int
}

func canvasBindTargets(task model.Task, intents []localtask.CanvasBindingIntent) []canvasBindTarget {
	seen := map[string]bool{}
	targets := make([]canvasBindTarget, 0, len(intents)+1)
	add := func(nodeID string, outputIndex int) {
		nodeID = strings.TrimSpace(nodeID)
		if nodeID == "" {
			return
		}
		key := nodeID + ":" + strconv.Itoa(outputIndex)
		if seen[key] {
			return
		}
		seen[key] = true
		targets = append(targets, canvasBindTarget{nodeID: nodeID, outputIndex: outputIndex})
	}
	for _, intent := range intents {
		if intent.TargetBinding == nil {
			continue
		}
		add(intent.TargetBinding.NodeID, intent.OutputIndex)
	}
	switch strings.TrimSpace(task.Type) {
	case "canvas_text", "text_replay":
		add(localtask.TargetBindingFromInput(task.InputJSON).NodeID, 0)
	}
	return targets
}

func messageBindTargets(task model.Task, intents []localtask.CanvasBindingIntent) []messageBindTarget {
	seen := map[string]bool{}
	targets := make([]messageBindTarget, 0, len(intents)+1)
	add := func(conversationID, messageID string, outputIndex int) {
		conversationID = strings.TrimSpace(conversationID)
		messageID = strings.TrimSpace(messageID)
		if conversationID == "" || messageID == "" {
			return
		}
		key := conversationID + ":" + messageID + ":" + strconv.Itoa(outputIndex)
		if seen[key] {
			return
		}
		seen[key] = true
		targets = append(targets, messageBindTarget{conversationID: conversationID, messageID: messageID, outputIndex: outputIndex})
	}
	for _, intent := range intents {
		if intent.TargetBinding == nil {
			continue
		}
		add(intent.TargetBinding.ConversationID, intent.TargetBinding.MessageID, intent.OutputIndex)
	}
	target := localtask.TargetBindingFromInput(task.InputJSON)
	add(target.ConversationID, target.MessageID, 0)
	return targets
}

// noteSkippedCanvasBind 记录「因为目标已不存在而跳过」的绑定：recovery 每 5 秒会重走一遍，
// 所以只在第一次遇到时打一条日志，之后静默跳过，既止血又不丢信号。
func (s *Service) noteSkippedCanvasBind(opID string, err error) {
	if s == nil || strings.TrimSpace(opID) == "" {
		return
	}
	var opErr *operations.Error
	if !errors.As(err, &opErr) || opErr.Reason != "not_found" {
		return
	}
	s.bindSkipMu.Lock()
	if s.bindSkipLogged == nil {
		s.bindSkipLogged = map[string]struct{}{}
	}
	_, seen := s.bindSkipLogged[opID]
	if !seen {
		s.bindSkipLogged[opID] = struct{}{}
	}
	s.bindSkipMu.Unlock()
	if !seen {
		log.Printf("generation canvas bind skipped：目标已不存在，不再重试 op=%s error=%v", opID, err)
	}
}

func skippableCanvasBindError(err error) bool {
	if err == nil {
		return true
	}
	if bindInfrastructureUnavailable(err) {
		return true
	}
	var opErr *operations.Error
	if !errors.As(err, &opErr) {
		return false
	}
	switch opErr.Reason {
	// 目标实体（画布/节点/资源/素材）已经不存在：这是永久状态，重试永远不会成功。
	// 典型来源是「画布被删了，但它的历史任务还在被 recovery 扫描」——不该让整轮 recovery
	// 报错，更不该每 5 秒刷一条日志（2026-10-15 那 5 个已删测试画布就是这么刷出来的）。
	case "not_found":
		return true
	case "node_deleted", "node_task_mismatch", "node_mismatch", "canvas_mismatch",
		"conversation_deleted", "message_deleted", "message_mismatch", "conversation_mismatch",
		"message_task_mismatch",
		"task_not_found", "task_not_succeeded", "task_foreign",
		"output_not_ready", "resource_not_ready", "resource_missing", "resource_foreign",
		"resource_mismatch", "asset_foreign", "delivery_unreadable", "unsupported_result_shape",
		"effect_identity_mismatch":
		return true
	default:
		return false
	}
}

func bindInfrastructureUnavailable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		strings.Contains(message, "op_store_unavailable") ||
		strings.Contains(message, "op_domain_unavailable")
}
