package modelcatalog

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/providerpreset"
)

func TestDefaultPixelPresetsSatisfyImageGenerationConstraints(t *testing.T) {
	count := 0
	for _, size := range defaultImageSizeValues() {
		if !strings.Contains(size, "x") {
			continue
		}
		count++
		if err := validateGPTImage2CustomSize(size); err != nil {
			t.Errorf("default pixel preset %q: %v", size, err)
		}
	}
	if count != 30 {
		t.Fatalf("expected all 30 pixel presets, got %d", count)
	}
}

func TestNormalizeCustomImageModelWithoutGuessedLimits(t *testing.T) {
	input := &ModelCapabilityConfig{Version: 1, Image: DefaultImageCapabilityConfig("openai-image", "my-custom-doodle")}
	normalized, err := NormalizeModelCapabilityConfigForModel("image", "openai-image", "my-custom-doodle", input)
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Image == nil || normalized.Image.References.MaxImages != 16 {
		t.Fatalf("custom image model should keep stored defaults, got %#v", normalized.Image)
	}
}

func TestMidjourneyImageCapabilityUsesSpeedTiersAndFourOutputs(t *testing.T) {
	profile := DefaultImageCapabilityConfig("midjourney", "midjourney-imagine")
	if profile.MaxOutputs != 4 || profile.FixedOutputs != 4 || profile.References.MaskSupported || profile.Size.Parameter != "aspect_ratio" {
		t.Fatalf("unexpected Midjourney profile: %#v", profile)
	}
	if !containsCapabilityString(profile.Quality.Values, "relax") || !containsCapabilityString(profile.Quality.Values, "fast") || !containsCapabilityString(profile.Quality.Values, "turbo") || profile.Quality.Default != "relax" {
		t.Fatalf("Midjourney speed tiers = %#v", profile.Quality)
	}
}

func TestDisabledAndUnavailableModelsAreNotPublic(t *testing.T) {
	channels := []model.ModelChannel{
		{ID: "sys", Name: "系统", Enabled: true, SortOrder: 1},
		{ID: "off", Name: "停用", Enabled: false},
	}
	models := map[string][]model.ChannelModel{
		"sys": {
			{ID: "ok", ChannelID: "sys", ModelKey: "ok", DisplayName: "可用", Capability: "audio", Protocol: "openai-audio", Enabled: true},
			{ID: "disabled", ChannelID: "sys", ModelKey: "disabled", DisplayName: "停用模型", Capability: "audio", Protocol: "openai-audio", Enabled: false},
		},
		"off": {
			{ID: "hidden", ChannelID: "off", ModelKey: "hidden", DisplayName: "渠道停用", Capability: "audio", Protocol: "openai-audio", Enabled: true},
		},
	}
	catalog, err := PublicSystemChannelCatalog(channels, func(channelID string) ([]model.ChannelModel, error) {
		return models[channelID], nil
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog) != 1 || catalog[0].ID != "sys" || len(catalog[0].Models) != 1 || catalog[0].Models[0].ModelKey != "ok" {
		t.Fatalf("catalog should publish only enabled models on enabled channels: %#v", catalog)
	}
	if catalog[0].Models[0].CapabilityConfig != nil {
		t.Fatal("audio models must not leak a capability JSON object")
	}
}

func TestSanitizeChannelModelOmitsSecrets(t *testing.T) {
	cfg := DefaultModelCapabilityConfigForModel("newapi-channel-2", "seedance-2.0")
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	public, err := SanitizeChannelModel(&model.ChannelModel{
		ID: "m1", ChannelID: "sys", ModelKey: "seed", DisplayName: "Seed",
		Capability: "video", Protocol: "newapi-channel-2", Enabled: true,
		CapabilityConfigJSON: string(encoded),
	})
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(body))
	if strings.Contains(lower, "apikey") || strings.Contains(lower, "secret") || strings.Contains(lower, "baseurl") {
		t.Fatalf("public model leaked credential-shaped fields: %s", body)
	}
}

func TestDefaultVideoCapabilitiesDoNotExceedVerifiedContracts(t *testing.T) {
	protocols := []string{"newapi", "newapi-channel-2", "openai-videos", "minimax-video"}
	for _, contract := range providerpreset.VideoContracts() {
		for _, modelName := range contract.Models {
			for _, protocol := range protocols {
				t.Run(modelName+"/"+protocol, func(t *testing.T) {
					profile := DefaultModelCapabilityConfigForModel(protocol, modelName)
					if profile == nil || profile.Video == nil {
						t.Fatal("default video capability is nil")
					}
					video := profile.Video
					if contract.Duration != nil {
						if video.Duration.Selection != "range" || video.Duration.Min < contract.Duration.Min || video.Duration.Max > contract.Duration.Max {
							t.Fatalf("duration = %#v, contract = %#v", video.Duration, *contract.Duration)
						}
						if video.Duration.Default < contract.Duration.Min || video.Duration.Default > contract.Duration.Max {
							t.Fatalf("default duration = %d, contract = %#v", video.Duration.Default, *contract.Duration)
						}
					}
					if len(contract.Resolutions) > 0 {
						for _, resolution := range video.Resolutions {
							if !containsCapabilityString(contract.Resolutions, resolution) {
								t.Fatalf("resolution %q exceeds contract %v", resolution, contract.Resolutions)
							}
						}
					}
					if limit, ok := contract.MaxReferences["image"]; ok && video.References.MaxImages > limit {
						t.Fatalf("maxImages = %d, contract = %d", video.References.MaxImages, limit)
					}
					if limit, ok := contract.MaxReferences["video"]; ok && video.References.MaxVideos > limit {
						t.Fatalf("maxVideos = %d, contract = %d", video.References.MaxVideos, limit)
					}
					if limit, ok := contract.MaxReferences["audio"]; ok && video.References.MaxAudios > limit {
						t.Fatalf("maxAudios = %d, contract = %d", video.References.MaxAudios, limit)
					}
					if len(contract.Operations) > 0 {
						for _, operation := range video.Operations {
							if !containsCapabilityString(contract.Operations, operation) {
								t.Fatalf("operation %q exceeds contract %v", operation, contract.Operations)
							}
						}
					}
					if contract.GenerateAudio != nil && video.GenerateAudio.Supported != *contract.GenerateAudio {
						t.Fatalf("generateAudio supported = %v, contract = %v", video.GenerateAudio.Supported, *contract.GenerateAudio)
					}
				})
			}
		}
	}
}

func TestCorruptCapabilityJSONFailsClosedOnSanitize(t *testing.T) {
	_, err := SanitizeChannelModel(&model.ChannelModel{
		ID: "bad", ModelKey: "bad", Capability: "video", Protocol: "newapi", Enabled: true,
		CapabilityConfigJSON: "{not-json",
	})
	if err == nil {
		t.Fatal("corrupt capability JSON must fail closed")
	}
}
