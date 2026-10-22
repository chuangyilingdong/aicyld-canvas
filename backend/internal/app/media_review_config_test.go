package app

import "testing"

func TestMergePlatformMediaReviewConfig(t *testing.T) {
	snapshot := assistantConfigSnapshot{MediaReviewModel: "local::review", Channels: []assistantChannel{{ID: "local"}}}
	platform := []assistantChannel{{ID: "platform", Models: []string{"qwen/qwen3.8-omni-flash"}}}
	merged := mergePlatformMediaReviewConfig(snapshot, platform, map[string]string{"media.review": "platform::qwen/qwen3.8-omni-flash"})
	if merged.MediaReviewModel != "platform::qwen/qwen3.8-omni-flash" {
		t.Fatalf("media review model = %q", merged.MediaReviewModel)
	}
	if len(merged.Channels) != 2 || merged.Channels[0].ID != "platform" || merged.Channels[1].ID != "local" {
		t.Fatalf("channels = %+v", merged.Channels)
	}
}
