package platformchannels

import (
	"encoding/json"
	"os"
	"runtime"
	"testing"
)

func TestConfiguredRequiresAnOperatorWrittenDocument(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if store.Configured() {
		t.Fatal("missing platform document must not be treated as configured")
	}
	if _, err := store.Save([]Channel{{
		ID: "example", Name: "Example", BaseURL: "https://example.test", APIKey: "secret",
		APIFormat: "openai", Enabled: true,
		ModelProfiles: []ModelProfile{{Model: "text-model", Capability: "text", Protocol: "chat-completion"}},
	}}); err != nil {
		t.Fatal(err)
	}
	if !store.Configured() {
		t.Fatal("saved platform document was not detected")
	}
	info, err := os.Stat(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("platform document mode = %o, want 600", info.Mode().Perm())
	}
}

func TestDefaultsIncludeRunningHubGPTImageProfile(t *testing.T) {
	var found *ModelProfile
	for _, channel := range Defaults() {
		for index := range channel.ModelProfiles {
			if channel.ModelProfiles[index].Model == "rh-gpt-image-2.6-sunburst-i2i" {
				found = &channel.ModelProfiles[index]
				break
			}
		}
	}
	if found == nil || found.Protocol != "runninghub-standard-image" || found.Capability != "image" {
		t.Fatalf("RunningHub GPT image profile = %#v", found)
	}
	var config struct {
		Image struct {
			Quality struct {
				Values  []string `json:"values"`
				Default string   `json:"default"`
			} `json:"quality"`
			References struct {
				MaxImages     int  `json:"maxImages"`
				MaskSupported bool `json:"maskSupported"`
			} `json:"references"`
		} `json:"image"`
	}
	if err := json.Unmarshal(found.CapabilityConfig, &config); err != nil {
		t.Fatal(err)
	}
	if config.Image.References.MaxImages != 16 || !config.Image.References.MaskSupported || config.Image.Quality.Default != "auto" {
		t.Fatalf("RunningHub GPT image capability = %#v", config.Image)
	}
}

func TestDefaultsIncludeSeedream55AndYouchuanProfiles(t *testing.T) {
	want := map[string]struct {
		family      string
		providerKey string
		maxImages   int
		baseURL     string
	}{
		"rh-seedream-v5.5-t2i":         {family: "Seedream 5.5", providerKey: "seedream-v5.5/text-to-image", maxImages: 0, baseURL: "https://www.runninghub.cn"},
		"rh-seedream-v5.5-i2i":         {family: "Seedream 5.5", providerKey: "seedream-v5.5/image-to-image", maxImages: 10, baseURL: "https://www.runninghub.cn"},
		"rh-midjourney-v8.1-t2i":       {family: "悠船 V8.1", providerKey: "youchuan/text-to-image-v81", maxImages: 2, baseURL: "https://www.runninghub.ai"},
		"rh-midjourney-v8.2-fast-t2i":  {family: "悠船 V8.2", providerKey: "youchuan/text-to-image-v8.2-fast", maxImages: 2, baseURL: "https://www.runninghub.ai"},
		"rh-midjourney-v8.2-turbo-t2i": {family: "悠船 V8.2", providerKey: "youchuan/text-to-image-v8.2-turbo", maxImages: 2, baseURL: "https://www.runninghub.ai"},
	}
	for _, channel := range Defaults() {
		for _, profile := range channel.ModelProfiles {
			expected, ok := want[profile.Model]
			if !ok {
				continue
			}
			if profile.Family != expected.family || profile.ProviderModelKey != expected.providerKey || channel.BaseURL != expected.baseURL {
				t.Fatalf("%s profile = %#v", profile.Model, profile)
			}
			var capability struct {
				Image struct {
					References struct {
						MaxImages int `json:"maxImages"`
					} `json:"references"`
				} `json:"image"`
			}
			if err := json.Unmarshal(profile.CapabilityConfig, &capability); err != nil {
				t.Fatal(err)
			}
			if capability.Image.References.MaxImages != expected.maxImages {
				t.Fatalf("%s maxImages = %d", profile.Model, capability.Image.References.MaxImages)
			}
			delete(want, profile.Model)
		}
	}
	if len(want) != 0 {
		t.Fatalf("missing default profiles: %#v", want)
	}
}

func TestDefaultsIncludeVerifiedMultimodalReviewProfile(t *testing.T) {
	for _, channel := range Defaults() {
		for _, profile := range channel.ModelProfiles {
			if profile.Model == "openai/gpt-6.2-sol-saver" {
				if profile.Capability != "text" || profile.Protocol != "chat-completion" {
					t.Fatalf("RunningHub review profile = %#v", profile)
				}
				return
			}
		}
	}
	t.Fatal("default platform profiles are missing openai/gpt-6.2-sol-saver")
}

func TestDefaultsIncludeMagi2VideoVariantsAndPromptRules(t *testing.T) {
	for _, channel := range Defaults() {
		for _, profile := range channel.ModelProfiles {
			if profile.Model != "rh-magi-2" {
				continue
			}
			if profile.Capability != "video" || profile.Protocol != "runninghub-standard-video" {
				t.Fatalf("MAGI-2 profile = %#v", profile)
			}
			want := map[string]string{
				"text_to_video":      "sand-ai/magi-2/text-to-video",
				"image_to_video":     "sand-ai/magi-2/image-to-video",
				"first_last_frame":   "sand-ai/magi-2/image-to-video",
				"reference_to_video": "sand-ai/magi-2/reference-to-video",
			}
			for _, variant := range profile.Variants {
				operation := variant.Selector["operation"]
				if want[operation] != variant.ProviderModelKey {
					t.Fatalf("MAGI-2 variant %s = %q", operation, variant.ProviderModelKey)
				}
				delete(want, operation)
			}
			if len(want) != 0 {
				t.Fatalf("missing MAGI-2 variants: %#v", want)
			}
			var config struct {
				Video struct {
					OptionalPromptOperations []string `json:"optionalPromptOperations"`
					Duration                 struct {
						Min int `json:"min"`
						Max int `json:"max"`
					} `json:"duration"`
					OperationReferences map[string]struct {
						MaxImages int `json:"maxImages"`
					} `json:"operationReferences"`
				} `json:"video"`
			}
			if err := json.Unmarshal(profile.CapabilityConfig, &config); err != nil {
				t.Fatal(err)
			}
			if !equalStrings(config.Video.OptionalPromptOperations, []string{"image_to_video", "first_last_frame"}) {
				t.Fatalf("MAGI-2 optional prompt operations = %#v", config.Video.OptionalPromptOperations)
			}
			if config.Video.Duration.Min != 4 || config.Video.Duration.Max != 30 ||
				config.Video.OperationReferences["image_to_video"].MaxImages != 2 ||
				config.Video.OperationReferences["first_last_frame"].MaxImages != 2 {
				t.Fatalf("MAGI-2 video config = %#v", config.Video)
			}
			return
		}
	}
	t.Fatal("default platform profiles are missing rh-magi-2")
}

func TestDefaultsIncludeGPTImage26Capabilities(t *testing.T) {
	var found *ModelProfile
	for _, channel := range Defaults() {
		for index := range channel.ModelProfiles {
			if channel.ModelProfiles[index].Model == "rh-gpt-image-2.6-sunburst-i2i" {
				found = &channel.ModelProfiles[index]
				break
			}
		}
	}
	if found == nil || found.Capability != "image" || found.Protocol != "runninghub-standard-image" {
		t.Fatalf("GPT Image 2.6 profile = %#v", found)
	}
	var config struct {
		Image struct {
			References struct {
				PromptMaxChars int `json:"promptMaxChars"`
				MaxImages      int `json:"maxImages"`
			} `json:"references"`
			Quality struct {
				Values  []string `json:"values"`
				Default string   `json:"default"`
			} `json:"quality"`
			MaxOutputs int `json:"maxOutputs"`
		} `json:"image"`
	}
	if err := json.Unmarshal(found.CapabilityConfig, &config); err != nil {
		t.Fatal(err)
	}
	if config.Image.References.PromptMaxChars != 32000 || config.Image.References.MaxImages != 16 || config.Image.Quality.Default != "auto" {
		t.Fatalf("GPT Image 2.6 capability = %#v", config.Image)
	}
}

func TestSeedance25ProfileAllowsThirtySeconds(t *testing.T) {
	type durationConfig struct {
		Video struct {
			Duration struct {
				Min int `json:"min"`
				Max int `json:"max"`
			} `json:"duration"`
			References struct {
				MaxVideoDurationSeconds int `json:"maxVideoDurationSeconds"`
				MaxAudioDurationSeconds int `json:"maxAudioDurationSeconds"`
			} `json:"references"`
		} `json:"video"`
	}
	for _, tc := range []struct {
		model   string
		wantMin int
		wantMax int
	}{
		{model: "seedance-2.5-standard", wantMin: 4, wantMax: 30},
		{model: "seedance-2.0-standard", wantMin: 4, wantMax: 15},
	} {
		raw, ok := VideoCapabilityConfigForModel(tc.model)
		if !ok {
			t.Fatalf("missing capability for %s", tc.model)
		}
		var config durationConfig
		if err := json.Unmarshal(raw, &config); err != nil {
			t.Fatal(err)
		}
		if config.Video.Duration.Min != tc.wantMin || config.Video.Duration.Max != tc.wantMax {
			t.Fatalf("%s duration = %d-%d, want %d-%d", tc.model, config.Video.Duration.Min, config.Video.Duration.Max, tc.wantMin, tc.wantMax)
		}
		if config.Video.References.MaxVideoDurationSeconds != tc.wantMax || config.Video.References.MaxAudioDurationSeconds != tc.wantMax {
			t.Fatalf("%s reference duration caps = %#v", tc.model, config.Video.References)
		}
	}
}

func TestKlingV4ProfilesMatchUpstreamModes(t *testing.T) {
	for _, tc := range []struct {
		model       string
		resolutions []string
		ratios      []string
		maxDuration int
		maxImages   int
		maxVideos   int
	}{
		{model: "kling-v4-flash", resolutions: []string{"720p"}, ratios: []string{"21:9", "16:9", "1:1", "9:16"}, maxDuration: 20, maxImages: 10, maxVideos: 5},
		{model: "kling-v4-t2v", resolutions: []string{"720p", "1080p"}, ratios: []string{"21:9", "16:9", "1:1", "9:16"}, maxDuration: 30},
		{model: "kling-v4-i2v", resolutions: []string{"720p", "1080p"}, ratios: []string{"adaptive"}, maxDuration: 30, maxImages: 2},
		{model: "kling-v4-omni", resolutions: []string{"720p", "1080p"}, ratios: []string{"adaptive", "21:9", "16:9", "1:1", "9:16"}, maxDuration: 30, maxImages: 10, maxVideos: 5},
	} {
		raw, ok := CapabilityConfigFor("video", tc.model)
		if !ok {
			t.Fatalf("missing capability for %s", tc.model)
		}
		var config struct {
			Video struct {
				Duration struct {
					Max int `json:"max"`
				} `json:"duration"`
				Ratios      []string `json:"ratios"`
				Resolutions []string `json:"resolutions"`
				References  struct {
					MaxImages int `json:"maxImages"`
					MaxVideos int `json:"maxVideos"`
				} `json:"references"`
			} `json:"video"`
		}
		if err := json.Unmarshal(raw, &config); err != nil {
			t.Fatal(err)
		}
		if config.Video.Duration.Max != tc.maxDuration || config.Video.References.MaxImages != tc.maxImages ||
			config.Video.References.MaxVideos != tc.maxVideos || !equalStrings(config.Video.Ratios, tc.ratios) ||
			!equalStrings(config.Video.Resolutions, tc.resolutions) {
			t.Fatalf("%s capability = %#v", tc.model, config.Video)
		}
	}
}

func TestMiniMaxH3ImageProfileSupportsOneFourKOutput(t *testing.T) {
	raw, ok := CapabilityConfigFor("image", "minimax-h3-image")
	if !ok {
		t.Fatal("missing MiniMax H3 Image capability")
	}
	var config struct {
		Image struct {
			References struct {
				MaxImages int `json:"maxImages"`
			} `json:"references"`
			Quality struct {
				Values []string `json:"values"`
			} `json:"quality"`
			MaxOutputs int      `json:"maxOutputs"`
			Operations []string `json:"operations"`
		} `json:"image"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	if config.Image.References.MaxImages != 16 || config.Image.MaxOutputs != 1 ||
		!equalStrings(config.Image.Quality.Values, []string{"1k", "2k", "4k"}) ||
		!equalStrings(config.Image.Operations, []string{"text_to_image", "image_to_image"}) {
		t.Fatalf("MiniMax H3 Image capability = %#v", config.Image)
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
