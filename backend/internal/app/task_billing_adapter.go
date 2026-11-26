package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	billingclient "infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

type taskBillingAdapter struct {
	client  *billingclient.Client
	service *Service
}

func (a taskBillingAdapter) Enabled() bool {
	return a.client != nil && a.client.Enabled()
}

func (a taskBillingAdapter) Quote(ctx context.Context, userID string, task *model.Task) (*billingclient.BillingQuote, error) {
	if a.client == nil || !a.client.Enabled() {
		return &billingclient.BillingQuote{Enabled: false}, nil
	}
	snapshot, err := a.billingTaskSnapshot(ctx, task)
	if err != nil {
		return nil, err
	}
	quote, err := a.client.Quote(ctx, userID, snapshot)
	if err != nil {
		if billingclient.IsRuleMissing(err) {
			return nil, kernel.BadAuthRequest(err.Error())
		}
		return nil, err
	}
	return quote, nil
}

func (a taskBillingAdapter) Reserve(ctx context.Context, userID string, task *model.Task) (*billingclient.BillingReservation, error) {
	if a.client == nil || !a.client.Enabled() {
		return &billingclient.BillingReservation{Enabled: false, Status: "free"}, nil
	}
	snapshot, err := a.billingTaskSnapshot(ctx, task)
	if err != nil {
		return nil, err
	}
	reservation, err := a.client.Reserve(ctx, userID, snapshot)
	if err != nil {
		if billingclient.IsInsufficient(err) {
			return nil, kernel.NewAppError(402, err.Error())
		}
		if billingclient.IsRuleMissing(err) {
			return nil, kernel.BadAuthRequest(err.Error())
		}
		return nil, err
	}
	return reservation, nil
}

func (a taskBillingAdapter) Settle(ctx context.Context, task *model.Task, outcome string, reason string) (*billingclient.BillingSettlement, error) {
	if a.client == nil || !a.client.Enabled() {
		return &billingclient.BillingSettlement{Status: "free"}, nil
	}
	return a.client.Settle(ctx, billingTaskSnapshot(task), outcome, reason)
}

func (a taskBillingAdapter) Release(ctx context.Context, task *model.Task, reason string) (*billingclient.BillingSettlement, error) {
	if a.client == nil || !a.client.Enabled() {
		return &billingclient.BillingSettlement{Status: "free"}, nil
	}
	return a.client.Release(ctx, billingTaskSnapshot(task), reason)
}

func (a taskBillingAdapter) billingTaskSnapshot(ctx context.Context, task *model.Task) (*billingclient.TaskSnapshot, error) {
	snapshot := billingTaskSnapshot(task)
	if snapshot == nil || a.service == nil {
		return snapshot, nil
	}
	facts, err := a.service.managedToolBillingFacts(ctx, task)
	if err != nil {
		return nil, err
	}
	snapshot.ManagedToolFacts = facts
	return snapshot, nil
}

func taskClientOperationID(task *model.Task) string {
	if task == nil || task.ClientOperationID == nil {
		return ""
	}
	return *task.ClientOperationID
}

func billingTaskSnapshot(task *model.Task) *billingclient.TaskSnapshot {
	if task == nil {
		return nil
	}
	return &billingclient.TaskSnapshot{
		ID:                task.ID,
		ProjectID:         task.ProjectID,
		RouteRun:          task.RouteRun,
		Type:              task.Type,
		Operation:         task.Operation,
		Provider:          task.Provider,
		Model:             task.Model,
		Prompt:            task.Prompt,
		InputJSON:         task.InputJSON,
		ClientOperationID: taskClientOperationID(task),
		BillingHoldID:     task.BillingHoldID,
	}
}

const (
	runningHubImageUpscaleEndpoint = generation.RunningHubImageUpscaleEndpoint
	runningHubVideoUpscaleEndpoint = generation.RunningHubVideoUpscaleEndpoint
	runningHubSubtitleEndpoint     = generation.RunningHubSubtitleEraseEndpoint
	runningHubSubtitleProEndpoint  = generation.RunningHubSubtitleEraseProEndpoint
)

func (s *Service) managedToolBillingFacts(ctx context.Context, task *model.Task) (*billingclient.ManagedToolFacts, error) {
	if task == nil || (task.Operation != "media.upscale.runninghub" && task.Operation != "media.video.subtitle_erase.runninghub") {
		return nil, nil
	}
	if s == nil {
		return nil, errors.New("RunningHub 媒体工具计费校验服务不可用")
	}
	raw, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, errors.New("RunningHub 媒体工具计费输入无法解密")
	}
	var input generation.Input
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return nil, errors.New("RunningHub 媒体工具计费输入无效")
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, err
	}
	if config.InterfaceType != string(model.ChannelInterfaceRunningHubStandardImage) &&
		config.InterfaceType != string(model.ChannelInterfaceRunningHubStandardVideo) {
		return nil, errors.New("RunningHub 媒体工具必须使用已登记的标准图像或视频渠道")
	}
	endpoint := strings.TrimSpace(config.Model)
	channelModel, err := s.repo.ChannelModelByKey(config.ChannelID, config.ChannelModelKey)
	if err != nil || channelModel == nil || !channelModel.Enabled {
		return nil, errors.New("RunningHub 媒体工具模型已停用或不存在")
	}
	if channelModel.Protocol != model.ChannelInterfaceType(config.InterfaceType) {
		return nil, errors.New("RunningHub 媒体工具模型协议不匹配")
	}
	switch task.Operation {
	case "media.upscale.runninghub":
		if config.InterfaceType == string(model.ChannelInterfaceRunningHubStandardImage) && endpoint != runningHubImageUpscaleEndpoint {
			return nil, errors.New("RunningHub 图片超分 endpoint 不受支持")
		}
		if config.InterfaceType == string(model.ChannelInterfaceRunningHubStandardVideo) && endpoint != runningHubVideoUpscaleEndpoint {
			return nil, errors.New("RunningHub 视频超分 endpoint 不受支持")
		}
	case "media.video.subtitle_erase.runninghub":
		if config.InterfaceType != string(model.ChannelInterfaceRunningHubStandardVideo) ||
			(endpoint != runningHubSubtitleEndpoint && endpoint != runningHubSubtitleProEndpoint) {
			return nil, errors.New("RunningHub 去字幕 endpoint 不受支持")
		}
	}

	var source generation.Media
	switch {
	case input.Mode == "image" && len(input.ReferenceImages) == 1:
		source = input.ReferenceImages[0]
	case input.Mode == "video" && len(input.ReferenceVideos) == 1:
		source = input.ReferenceVideos[0]
	default:
		return nil, errors.New("RunningHub 媒体工具需要且仅需要一个源素材")
	}
	resourceID := strings.TrimPrefix(strings.TrimSpace(source.StorageKey), "resource:")
	if resourceID == "" || resourceID == source.StorageKey {
		return nil, errors.New("RunningHub 媒体工具源素材必须来自当前用户素材库")
	}
	resource, err := s.EnsureResourceMediaMetadata(ctx, task.UserID, resourceID)
	if err != nil || resource == nil || resource.Status != model.ResourceStatusReady {
		return nil, errors.New("RunningHub 媒体工具源素材不存在或未就绪")
	}

	facts := &billingclient.ManagedToolFacts{
		Operation: task.Operation, ModelKey: endpoint, DisplayName: channelModel.DisplayName,
		SourceDurationMs: resource.DurationMs, SourceWidth: resource.Width, SourceHeight: resource.Height,
	}
	if task.Operation == "media.upscale.runninghub" {
		if input.Upscale == nil {
			return nil, errors.New("RunningHub 超分任务缺少冻结参数")
		}
		facts.Scale = input.Upscale.Factor
		if input.Mode == "video" {
			facts.EnhancementModel = strings.ToLower(strings.TrimSpace(config.Quality))
		}
	}
	if task.Operation == "media.video.subtitle_erase.runninghub" && resource.DurationMs <= 0 {
		return nil, errors.New("RunningHub 去字幕无法读取服务端核验的视频时长")
	}
	if input.Mode == "image" && (resource.Width <= 0 || resource.Height <= 0) {
		return nil, errors.New("RunningHub 图片超分无法读取服务端核验的图片尺寸")
	}
	return facts, nil
}
