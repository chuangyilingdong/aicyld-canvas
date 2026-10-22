package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
)

type MidjourneyButtonSnapshot struct {
	Buttons        []map[string]any `json:"buttons"`
	ProviderStatus string           `json:"providerStatus"`
}

// RefreshMidjourneyButtons performs a read-only provider query and returns the
// current U1-U4 button snapshot. It never creates a new upstream task.
func (s *Service) RefreshMidjourneyButtons(ctx context.Context, userID, taskID string) (*MidjourneyButtonSnapshot, error) {
	task, err := s.repo.TaskForUser(strings.TrimSpace(userID), strings.TrimSpace(taskID))
	if err != nil {
		return nil, err
	}
	if task.Status != model.TaskStatusSucceeded {
		return nil, BadAuthRequest("只能刷新已成功的 Midjourney 任务")
	}
	s.hydrateTaskProviderRequestID(task)
	providerTaskID := strings.TrimSpace(task.ProviderRequestID)
	if providerTaskID == "" {
		return nil, BadAuthRequest("该任务没有上游 task_id")
	}
	decryptedInput, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, fmt.Errorf("读取任务配置失败：%w", err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(decryptedInput), &input); err != nil {
		return nil, fmt.Errorf("任务输入解析失败：%w", err)
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, err
	}
	if config.InterfaceType != string(model.ChannelInterfaceMidjourney) {
		return nil, BadAuthRequest("该任务不是 Midjourney 协议")
	}
	input.Config = config
	ctx = ensureOfficialProtocolAdapter(ctx, config.InterfaceType)
	adapter, ok := declarativeProtocolAdapterForContext(ctx, config.InterfaceType)
	if !ok {
		return nil, BadAuthRequest("Midjourney 协议未注册")
	}
	metadata, providerStatus, err := generation.QueryProtocolAdapterProviderMetadata(ctx, input, adapter, providerTaskID)
	if err != nil {
		return nil, err
	}
	buttons, _ := metadata["midjourneyButtons"].([]map[string]any)
	if len(buttons) == 0 {
		return nil, BadAuthRequest("上游任务没有可回填的 U1-U4 按钮，可能已过期")
	}
	return &MidjourneyButtonSnapshot{Buttons: buttons, ProviderStatus: providerStatus}, nil
}
