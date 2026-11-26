package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
)

func TestRunningHubCanvasToolModelDirectoryIsEndpointAndSiteBound(t *testing.T) {
	s, db := newChannelModelTestService(t)
	channels := []model.ModelChannel{
		{ID: "rh-cn", Scope: model.ChannelScopeSystem, Enabled: true, Name: "RunningHub CN", BaseURL: "https://www.runninghub.cn/openapi/v2", APIKey: "cn-key"},
		{ID: "rh-ai", Scope: model.ChannelScopeSystem, Enabled: true, Name: "RunningHub AI", BaseURL: "https://www.runninghub.ai/openapi/v2", APIKey: "ai-key"},
		{ID: "rh-disabled", Scope: model.ChannelScopeSystem, Enabled: false, Name: "Disabled", BaseURL: "https://www.runninghub.cn/openapi/v2", APIKey: "disabled-key"},
	}
	for index := range channels {
		if err := db.Create(&channels[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	models := []model.ChannelModel{
		{ID: "cn-subtitle", ChannelID: "rh-cn", ModelKey: "subtitle", ProviderModelKey: generation.RunningHubSubtitleEraseEndpoint, DisplayName: "Subtitle Erase", Capability: "video", Protocol: model.ChannelInterfaceRunningHubStandardVideo, Enabled: true},
		{ID: "cn-video", ChannelID: "rh-cn", ModelKey: "video-upscale", ProviderModelKey: generation.RunningHubVideoUpscaleEndpoint, DisplayName: "RH Upscale", Capability: "video", Protocol: model.ChannelInterfaceRunningHubStandardVideo, Enabled: true},
		{ID: "ai-image", ChannelID: "rh-ai", ModelKey: "image-upscale", ProviderModelKey: generation.RunningHubImageUpscaleEndpoint, DisplayName: "Topaz Standard", Capability: "image", Protocol: model.ChannelInterfaceRunningHubStandardImage, Enabled: true},
		{ID: "cn-wrong-site", ChannelID: "rh-cn", ModelKey: "wrong-site", ProviderModelKey: generation.RunningHubImageUpscaleEndpoint, DisplayName: "Wrong Site", Capability: "image", Protocol: model.ChannelInterfaceRunningHubStandardImage, Enabled: true},
		{ID: "cn-unrelated", ChannelID: "rh-cn", ModelKey: "ordinary-video", ProviderModelKey: "bytedance/seedance-2.5/text-to-video", DisplayName: "Ordinary video", Capability: "video", Protocol: model.ChannelInterfaceRunningHubStandardVideo, Enabled: true},
		{ID: "disabled-image", ChannelID: "rh-disabled", ModelKey: "disabled-image", ProviderModelKey: generation.RunningHubImageUpscaleEndpoint, DisplayName: "Disabled image", Capability: "image", Protocol: model.ChannelInterfaceRunningHubStandardImage, Enabled: true},
		{ID: "disabled-model", ChannelID: "rh-cn", ModelKey: "disabled-model", ProviderModelKey: generation.RunningHubVideoUpscaleEndpoint, DisplayName: "Disabled model", Capability: "video", Protocol: model.ChannelInterfaceRunningHubStandardVideo, Enabled: false},
	}
	for index := range models {
		if err := db.Create(&models[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	video := s.runningHubCanvasToolModels("video")
	if len(video) != 2 || video[0].Endpoint != generation.RunningHubSubtitleEraseEndpoint || video[1].Endpoint != generation.RunningHubVideoUpscaleEndpoint {
		t.Fatalf("video tool models = %#v", video)
	}
	image := s.runningHubCanvasToolModels("image")
	if len(image) != 1 || image[0].Endpoint != generation.RunningHubImageUpscaleEndpoint || image[0].ChannelID != "rh-ai" {
		t.Fatalf("image tool models = %#v", image)
	}
	for _, item := range append(video, image...) {
		if strings.Contains(item.Label, "key") {
			t.Fatalf("public tool model leaked credential: %#v", item)
		}
	}
}

func TestRunningHubCanvasToolConfigUsesServerChannelRecord(t *testing.T) {
	s, db := newChannelModelTestService(t)
	channel := model.ModelChannel{
		ID: "rh-cn", Scope: model.ChannelScopeSystem, Enabled: true, Name: "RunningHub CN",
		BaseURL: "https://www.runninghub.cn/openapi/v2", APIKey: "server-key",
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(
		string(model.ChannelInterfaceRunningHubStandardVideo), generation.RunningHubVideoUpscaleEndpoint,
	))
	channelModel := model.ChannelModel{
		ID: "video-upscale", ChannelID: channel.ID, ModelKey: "video-upscale",
		ProviderModelKey: generation.RunningHubVideoUpscaleEndpoint,
		DisplayName:      "RH Upscale", Capability: "video",
		Protocol:             model.ChannelInterfaceRunningHubStandardVideo,
		CapabilityConfigJSON: profile, Enabled: true,
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	config, resolved, err := s.resolveRunningHubCanvasToolConfig(channel.ID, channelModel.ModelKey, "video")
	if err != nil {
		t.Fatal(err)
	}
	if config.Model != generation.RunningHubVideoUpscaleEndpoint ||
		config.APIKey != "server-key" ||
		config.ChannelModelKey != channelModel.ModelKey ||
		resolved.ModelKey != channelModel.ModelKey {
		t.Fatalf("resolved RunningHub tool config=%+v model=%+v", config, resolved)
	}
	for _, tc := range []struct {
		channelID  string
		modelKey   string
		capability string
	}{
		{channel.ID, channelModel.ModelKey, "image"},
		{channel.ID, "missing", "video"},
	} {
		if _, _, err := s.resolveRunningHubCanvasToolConfig(tc.channelID, tc.modelKey, tc.capability); err == nil {
			t.Fatalf("invalid tool selection accepted: %+v", tc)
		}
	}
}

func TestRunningHubCanvasToolAdmissionRebuildsChannelIdentity(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.mode = serviceModeHosted
	channel := model.ModelChannel{
		ID: "rh-cn", Scope: model.ChannelScopeSystem, Enabled: true, Name: "RunningHub CN",
		BaseURL: "https://www.runninghub.cn/openapi/v2", APIKey: "trusted-server-key",
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(
		string(model.ChannelInterfaceRunningHubStandardVideo), generation.RunningHubVideoUpscaleEndpoint,
	))
	channelModel := model.ChannelModel{
		ID: "rh-video", ChannelID: channel.ID, ModelKey: "rh-video-upscale",
		ProviderModelKey: generation.RunningHubVideoUpscaleEndpoint,
		DisplayName:      "RH Upscale", Capability: "video",
		Protocol:             model.ChannelInterfaceRunningHubStandardVideo,
		CapabilityConfigJSON: profile, Enabled: true,
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	input := map[string]any{
		"mode":   "video",
		"prompt": "RunningHub AI 超分",
		"config": map[string]any{
			"channelId": channel.ID, "channelModelKey": channelModel.ModelKey,
			"model": channelModel.ModelKey, "providerModelKey": "forged/endpoint",
			"interfaceType": "openai-videos", "baseUrl": "https://attacker.invalid",
			"apiKey": "forged-key",
		},
		"upscale":         map[string]any{"factor": 2},
		"referenceVideos": []any{map[string]any{"storageKey": "resource:source"}},
	}
	selected, err := localtask.SelectCatalogTask("user", localtask.SelectRequest{
		Input: input, Model: channelModel.ModelKey, Type: "canvas_video",
	}, s.upscaleConfig, s.RequireWorkflowPluginForUser, func() (bool, error) { return false, nil }, s.taskSelectLookup())
	if err != nil {
		t.Fatal(err)
	}
	config := selected.Input["config"].(map[string]any)
	if config["interfaceType"] != string(model.ChannelInterfaceRunningHubStandardVideo) ||
		config["model"] != channelModel.ModelKey ||
		config["providerModelKey"] != generation.RunningHubVideoUpscaleEndpoint ||
		config["baseUrl"] != nil || config["apiKey"] != nil {
		t.Fatalf("system channel identity was not rebuilt: %#v", config)
	}
	forged := map[string]any{
		"mode": "video", "config": map[string]any{
			"channelId": channel.ID, "channelModelKey": channelModel.ModelKey,
			"model": channelModel.ModelKey, "providerModelKey": generation.RunningHubSubtitleEraseEndpoint,
			"interfaceType": string(model.ChannelInterfaceRunningHubStandardImage),
			"baseUrl":       "https://attacker.invalid", "apiKey": "forged-key",
		},
		"upscale": map[string]any{"factor": 2},
	}
	forgedSelection, err := localtask.SelectCatalogTask("user", localtask.SelectRequest{
		Input: forged, Model: channelModel.ModelKey, Type: "canvas_video",
	}, s.upscaleConfig, s.RequireWorkflowPluginForUser, func() (bool, error) { return false, nil }, s.taskSelectLookup())
	if err != nil {
		t.Fatalf("database-owned model was rejected because client forged endpoint or credentials: %v", err)
	}
	resolvedConfig := forgedSelection.Input["config"].(map[string]any)
	if resolvedConfig["providerModelKey"] != generation.RunningHubVideoUpscaleEndpoint ||
		resolvedConfig["interfaceType"] != string(model.ChannelInterfaceRunningHubStandardVideo) ||
		resolvedConfig["baseUrl"] != nil || resolvedConfig["apiKey"] != nil {
		t.Fatalf("client channel fields were not rebuilt from the system record: %#v", resolvedConfig)
	}
}

func TestRunningHubManagedToolBillingFactsUseOwnedResourceAndFrozenRequest(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.mode = serviceModeHosted
	channel := model.ModelChannel{
		ID: "rh-cn", Scope: model.ChannelScopeSystem, Enabled: true, Name: "RunningHub CN",
		BaseURL: "https://www.runninghub.cn/openapi/v2", APIKey: "server-key",
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(
		string(model.ChannelInterfaceRunningHubStandardVideo), generation.RunningHubSubtitleEraseEndpoint,
	))
	channelModel := model.ChannelModel{
		ID: "subtitle", ChannelID: channel.ID, ModelKey: "subtitle",
		ProviderModelKey: generation.RunningHubSubtitleEraseEndpoint,
		DisplayName:      "Subtitle Erase", Capability: "video",
		Protocol:             model.ChannelInterfaceRunningHubStandardVideo,
		CapabilityConfigJSON: profile, Enabled: true,
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "source-video", UserID: "user", Kind: "video", Provider: "local",
		Status: model.ResourceStatusReady, MimeType: "video/mp4", Size: 2048,
		Width: 1920, Height: 1080, DurationMs: 15_250, ObjectKey: "users/user/source.mp4",
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(generation.Input{
		Mode: "video", Config: generation.Config{
			ChannelID: channel.ID, ChannelModelKey: channelModel.ModelKey,
			Model: channelModel.ModelKey, InterfaceType: string(channelModel.Protocol),
		},
		SubtitleErase:   &generation.SubtitleEraseOptions{EraseMethod: "auto", SubtitleModel: "standard"},
		ReferenceVideos: []generation.Media{{StorageKey: "resource:" + resource.ID, DurationMs: 999_999}},
	})
	if err != nil {
		t.Fatal(err)
	}
	facts, err := s.managedToolBillingFacts(context.Background(), &model.Task{
		ID: "task", UserID: "user", Type: "canvas_video",
		Operation: runningHubToolSubtitleOperation, InputJSON: string(raw),
	})
	if err != nil {
		t.Fatal(err)
	}
	if facts.ModelKey != generation.RunningHubSubtitleEraseEndpoint || facts.SourceDurationMs != resource.DurationMs {
		t.Fatalf("billing facts trusted the client or wrong endpoint: %+v", facts)
	}

	input := generation.Input{
		Mode: "video",
		Config: generation.Config{
			ChannelID: channel.ID, ChannelModelKey: channelModel.ModelKey,
			Model: generation.RunningHubSubtitleEraseEndpoint, InterfaceType: string(channelModel.Protocol),
		},
		SubtitleErase:   &generation.SubtitleEraseOptions{EraseMethod: "auto"},
		ReferenceVideos: []generation.Media{{StorageKey: "resource:foreign"}},
	}
	raw, _ = json.Marshal(input)
	if _, err := s.managedToolBillingFacts(context.Background(), &model.Task{
		ID: "foreign-task", UserID: "other-user", Operation: runningHubToolSubtitleOperation, InputJSON: string(raw),
	}); err == nil {
		t.Fatal("a foreign user's source resource was accepted for managed-tool billing")
	}
}
