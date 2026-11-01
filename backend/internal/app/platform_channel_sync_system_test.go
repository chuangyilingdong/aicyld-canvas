package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platformchannels"
)

func TestSyncPlatformChannelsMirrorsSystemChannelAndModelVariant(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	warnings := svc.SyncPlatformChannels([]PlatformChannelInput{{
		ID: "aicyld-video", Name: "Platform Video", BaseURL: "https://example.com/v1",
		APIKey: "platform-secret", Enabled: true,
		Models: []PlatformChannelModel{{
			Model: "seedance-2.0", DisplayName: "Seedance", Capability: "video", Protocol: "newapi-channel-2",
			Variants: []platformchannels.ModelVariant{{
				Selector: map[string]string{"operation": "image_to_video"}, ProviderModelKey: "seedance-2.0-i2v",
			}},
		}},
	}})
	if len(warnings) != 0 {
		t.Fatalf("sync warnings = %v", warnings)
	}
	var channel model.ModelChannel
	if err := db.First(&channel, "id = ?", "aicyld-video").Error; err != nil {
		t.Fatal(err)
	}
	if channel.Scope != model.ChannelScopeSystem || !channel.Enabled || channel.Name != "Platform Video" {
		t.Fatalf("system channel = %+v", channel)
	}
	var channelModel model.ChannelModel
	if err := db.First(&channelModel, "channel_id = ? AND model_key = ?", channel.ID, "seedance-2.0").Error; err != nil {
		t.Fatal(err)
	}
	if channelModel.Protocol != model.ChannelInterfaceNewAPIChannel2 || channelModel.Capability != "video" {
		t.Fatalf("mirrored model = %+v", channelModel)
	}
}
