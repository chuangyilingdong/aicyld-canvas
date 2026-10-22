package app

import (
	"context"
	"errors"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

type MidjourneyModalRequest struct {
	Prompt         string `json:"prompt"`
	MaskResourceID string `json:"maskResourceId"`
}

// SubmitMidjourneyModal advances the existing inpaint task in place. It must
// not create a second local task: both requests target the same upstream task
// id, and the original worker continues polling until the final image arrives.
func (s *Service) SubmitMidjourneyModal(ctx context.Context, userID, taskID string, request MidjourneyModalRequest) (*model.Task, error) {
	userID = strings.TrimSpace(userID)
	taskID = strings.TrimSpace(taskID)
	request.Prompt = strings.TrimSpace(request.Prompt)
	request.MaskResourceID = strings.TrimSpace(request.MaskResourceID)
	if userID == "" || taskID == "" {
		return nil, BadAuthRequest("任务身份无效")
	}
	if request.Prompt == "" || request.MaskResourceID == "" {
		return nil, BadAuthRequest("MODAL 需要提示词和蒙版资源")
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if task.Type != "canvas_image" || (task.Status != model.TaskStatusQueued && task.Status != model.TaskStatusRunning) {
		return nil, BadAuthRequest("只有进行中的 Midjourney inpaint 任务可以提交 MODAL")
	}
	if strings.TrimSpace(task.PollStage) == "midjourney_modal_submitted" {
		return taskForOutput(*task), nil
	}
	s.hydrateTaskProviderRequestID(task)
	providerTaskID := strings.TrimSpace(task.ProviderRequestID)
	if providerTaskID == "" {
		return nil, BadAuthRequest("inpaint 任务缺少上游 task_id")
	}
	input, err := s.providerCancellationInput(task)
	if err != nil {
		return nil, err
	}
	if input.Config.InterfaceType != string(model.ChannelInterfaceMidjourney) {
		return nil, BadAuthRequest("当前任务不是 Midjourney 协议")
	}
	action := midjourneyInputAction(input.Metadata)
	if action != "inpaint" {
		return nil, BadAuthRequest("只有 inpaint 中间任务可以提交 MODAL")
	}

	input.Mode = "image"
	input.Prompt = request.Prompt
	input.ReferenceImages = nil
	input.ReferenceVideos = nil
	input.ReferenceAudios = nil
	input.Mask = &generation.Media{
		ID:         "midjourney-modal-mask",
		Name:       "midjourney-mask.png",
		Type:       "image/png",
		MimeType:   "image/png",
		StorageKey: "resource:" + request.MaskResourceID,
	}
	input.Metadata = map[string]any{
		"midjourney": map[string]any{
			"action": "modal",
			"taskId": providerTaskID,
		},
	}
	ctx = withProviderAnalytics(ctx, s, *task)
	ctx = withProviderRequestKind(ctx, "midjourney-modal")
	ctx = s.bindGenerationRuntime(ctx, generation.CallMeta{
		UserID:     userID,
		TaskID:     task.ID,
		ProjectID:  task.ProjectID,
		TaskType:   task.Type,
		Capability: "image",
		Operation:  "midjourney-modal",
	})
	if err := generation.HydrateMedia(ctx, userID, &input, generation.MediaHydrationPolicyFor(ctx, input)); err != nil {
		return nil, err
	}
	adapter, ok := protocol.Builtins().Get("midjourney")
	if !ok {
		return nil, errors.New("Midjourney 协议未注册")
	}
	generationRequest := generation.ProtocolRequestFromInput(input)
	spec, err := adapter.BuildCreate(ctx, protocol.RequestContext{BaseURL: input.Config.BaseURL, Request: generationRequest})
	if err != nil {
		return nil, err
	}
	body, err := generation.ExecuteProtocolRequest(ctx, input.Config, spec)
	if err != nil {
		return nil, err
	}
	created, err := adapter.ParseCreate(ctx, body)
	if err != nil {
		return nil, err
	}
	if created.Status == protocol.StatusFailed || created.Status == protocol.StatusCancelled {
		return nil, errors.New(defaultString(created.Message, "Midjourney MODAL 提交失败"))
	}
	if returnedTaskID := strings.TrimSpace(created.TaskID); returnedTaskID != "" && returnedTaskID != providerTaskID {
		providerTaskID = returnedTaskID
	}
	if err := s.repo.UpdateTaskProviderState(task.ID, providerTaskID, "midjourney_modal_submitted", task.NextPollAt); err != nil {
		_ = s.log(task.UserID, task.ID, "warn", "Midjourney MODAL 已提交，但任务状态保存失败", err.Error())
	}
	task.ProviderRequestID = providerTaskID
	task.PollStage = "midjourney_modal_submitted"
	_ = s.log(task.UserID, task.ID, "info", "已提交 Midjourney MODAL，继续轮询原任务", providerTaskID)
	return taskForOutput(*task), nil
}

func midjourneyInputAction(metadata map[string]any) string {
	configured, _ := metadata["midjourney"].(map[string]any)
	action, _ := configured["action"].(string)
	return strings.ToLower(strings.TrimSpace(action))
}
