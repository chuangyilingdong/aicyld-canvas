package app

import (
	"context"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
	"infinite-canvas/backend/internal/topaz"
)

type MediaUpscaleRequest = topaz.Request

func (s *Service) upscaleConfig(name string) (generation.Config, error) {
	return generation.UpscaleConfig(name, s.lookupBeefAPICredential)
}
func (s *Service) MediaUpscaleCapabilities(ctx context.Context) map[string]any {
	capabilities := generation.LiveUpscaleCapabilities(ctx, s.lookupBeefAPICredential, s.bindGenerationRuntime)
	capabilities["runningHubModels"] = s.runningHubCanvasToolModels("image")
	capabilities["runningHubVideoModels"] = s.runningHubCanvasToolModels("video")
	return capabilities
}
func (s *Service) EstimateMediaUpscale(ctx context.Context, user string, request topaz.Request) (map[string]any, error) {
	if request.Provider == "runninghub" {
		input, resource, _, err := runningHubUpscaleInput(ctx, s, user, request)
		if err != nil {
			return nil, err
		}
		enhancementModel := strings.ToLower(strings.TrimSpace(input.Config.Quality))
		facts := runningHubManagedToolBillingFacts(runningHubToolUpscaleOperation, input.Config, resource, input.Upscale.Factor, enhancementModel)
		return runningHubToolPointQuote(ctx, s, user, facts, resource, input.Mode, request.Scale)
	}
	return generation.EstimateMediaUpscale(ctx, user, request, s.EnsureResourceMediaMetadata, s.lookupBeefAPICredential, s.bindGenerationRuntime)
}
func (s *Service) CreateMediaUpscale(ctx context.Context, user string, request topaz.Request) (*model.Task, error) {
	if request.Provider == "runninghub" {
		if strings.TrimSpace(request.ClientOperationID) == "" {
			return nil, kernel.BadAuthRequest("缺少本次确认的操作 ID")
		}
		input, _, _, err := runningHubUpscaleInput(ctx, s, user, request)
		if err != nil {
			return nil, err
		}
		payload, err := buildManagedToolTaskPayload(input, runningHubToolUpscaleOperation, request.ClientOperationID, request.NodeID)
		if err != nil {
			return nil, err
		}
		return s.CreateTask(user, CreateTaskRequest{
			ProjectID: request.ProjectID, Type: "canvas_" + input.Mode,
			Operation: runningHubToolUpscaleOperation, Prompt: input.Prompt,
			Model: input.Config.Model, Provider: "managed", Input: payload,
		})
	}
	input, payload, err := generation.BuildMediaUpscaleTaskPayload(ctx, user, request, s.EnsureResourceMediaMetadata, s.lookupBeefAPICredential, s.bindGenerationRuntime)
	if err != nil {
		return nil, err
	}
	return s.CreateTask(user, CreateTaskRequest{ProjectID: request.ProjectID, Type: "canvas_" + input.Mode, Operation: "media.upscale.topaz", Prompt: "AI 超分", Model: input.Config.Model, Provider: "beefapi", Input: payload})
}
func (s *Service) VideoSubtitleEraseCapabilities(ctx context.Context) map[string]any {
	capabilities := generation.SubtitleEraseCapabilities(ctx, s.lookupBeefAPICredential, s.bindGenerationRuntime)
	capabilities["runningHubModels"] = s.runningHubCanvasToolModels("subtitle")
	return capabilities
}
func (s *Service) EstimateVideoSubtitleErase(ctx context.Context, user string, request generation.SubtitleEraseRequest) (map[string]any, error) {
	if request.Provider == "runninghub" {
		input, resource, _, err := runningHubSubtitleInput(ctx, s, user, request)
		if err != nil {
			return nil, err
		}
		facts := runningHubManagedToolBillingFacts(runningHubToolSubtitleOperation, input.Config, resource, 0, "")
		return runningHubToolPointQuote(ctx, s, user, facts, resource, "video", 0)
	}
	return generation.EstimateVideoSubtitleErase(ctx, user, request, s.EnsureResourceMediaMetadata, s.lookupBeefAPICredential, s.bindGenerationRuntime)
}
func (s *Service) CreateVideoSubtitleErase(ctx context.Context, user string, request generation.SubtitleEraseRequest) (*model.Task, error) {
	if request.Provider == "runninghub" {
		if strings.TrimSpace(request.ClientOperationID) == "" {
			return nil, kernel.BadAuthRequest("缺少本次确认的操作 ID")
		}
		input, _, _, err := runningHubSubtitleInput(ctx, s, user, request)
		if err != nil {
			return nil, err
		}
		payload, err := buildManagedToolTaskPayload(input, runningHubToolSubtitleOperation, request.ClientOperationID, request.NodeID)
		if err != nil {
			return nil, err
		}
		return s.CreateTask(user, CreateTaskRequest{
			ProjectID: request.ProjectID, Type: "canvas_video",
			Operation: runningHubToolSubtitleOperation, Prompt: input.Prompt,
			Model: input.Config.Model, Provider: "managed", Input: payload,
		})
	}
	input, payload, err := generation.BuildVideoSubtitleEraseTaskPayload(ctx, user, request, s.EnsureResourceMediaMetadata, s.lookupBeefAPICredential)
	if err != nil {
		return nil, err
	}
	return s.CreateTask(user, CreateTaskRequest{ProjectID: request.ProjectID, Type: "canvas_video", Operation: "media.video.subtitle_erase", Prompt: "视频去字幕", Model: input.Config.Model, Provider: "beefapi", Input: payload})
}
func (s *Service) RecoverMediaUpscale(ctx context.Context, user, id string) (*model.Task, error) {
	return s.recoverManagedTool(ctx, user, id, "超分", (model.Task).IsUpscale)
}
func (s *Service) RecoverVideoSubtitleErase(ctx context.Context, user, id string) (*model.Task, error) {
	return s.recoverManagedTool(ctx, user, id, "去字幕", (model.Task).IsSubtitleErase)
}
func (s *Service) recoverManagedTool(ctx context.Context, user, id, label string, match func(model.Task) bool) (*model.Task, error) {
	deps := localtask.ManagedToolRecoveryDeps{
		Repo: s.repo, Deliver: s.DeliverSucceededTask, ReloadTask: s.Task, ProjectTask: taskForOutput,
		HydrateReqID: s.hydrateTaskProviderRequestID, RecordMissing: s.recordMissingVideoReceiptOutcome, QueryFailed: s.QueryFailedVideoTask,
		HasManagedRef: func(c context.Context, t model.Task) (bool, error) {
			_, ok, err := s.managedTaskRecoveryQuery(c, t)
			return ok, err
		},
	}
	return localtask.RecoverManagedToolTaskForUser(ctx, deps, user, id, label, match)
}
