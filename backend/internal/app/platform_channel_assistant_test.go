package app

import (
	"testing"

	"infinite-canvas/backend/internal/platformchannels"
)

func TestAssistantUsesConfiguredPlatformChannelAndFeatureModel(t *testing.T) {
	dir := t.TempDir()
	store, err := platformchannels.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveAll([]platformchannels.Channel{{
		ID: "assistant", Name: "Platform Assistant", BaseURL: "https://assistant.example", APIKey: "assistant-secret",
		APIFormat: "openai", Enabled: true,
		Models: []string{platformchannels.DefaultAssistantModel, "review-model"},
		ModelProfiles: []platformchannels.ModelProfile{
			{Model: platformchannels.DefaultAssistantModel, Capability: "text", Protocol: "chat-completion"},
			{Model: "review-model", Capability: "text", Protocol: "chat-completion"},
		},
	}}, nil, map[string]string{"media.review": "aicyld-assistant::review-model"}); err != nil {
		t.Fatal(err)
	}
	service := NewLocal(nil, dir)
	provider, err := service.ResolveAssistantProvider()
	if err != nil {
		t.Fatal(err)
	}
	if provider.ChannelID != "aicyld-assistant" || provider.Model != platformchannels.DefaultAssistantModel || provider.APIKey != "assistant-secret" {
		t.Fatalf("assistant provider = %#v", provider)
	}
	snapshot, err := service.assistantConfig()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.MediaReviewModel != "aicyld-assistant::review-model" {
		t.Fatalf("media review model = %q", snapshot.MediaReviewModel)
	}
}

func TestPlatformPlaceholderResolvesOnlyForConfiguredOrigin(t *testing.T) {
	dir := t.TempDir()
	store, err := platformchannels.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Save([]platformchannels.Channel{{
		ID: "relay", Name: "Relay", BaseURL: "https://relay.example/v1", APIKey: "platform-real-secret",
		APIFormat: "openai", Enabled: true,
		ModelProfiles: []platformchannels.ModelProfile{{Model: "text", Capability: "text", Protocol: "chat-completion"}},
	}}); err != nil {
		t.Fatal(err)
	}
	service := NewLocal(nil, dir)
	key, err := service.ResolveCustomRelayAPIKey("https://relay.example/v1/chat/completions", platformchannels.PlaceholderSecret)
	if err != nil || key != "platform-real-secret" {
		t.Fatalf("placeholder key = %q err=%v", key, err)
	}
	key, err = service.ResolveCustomRelayAPIKey("https://relay.example/v1/chat/completions", "user-real-key")
	if err != nil || key != "user-real-key" {
		t.Fatalf("user key was replaced: %q err=%v", key, err)
	}
	key, err = service.ResolveCustomRelayAPIKey("https://attacker.example/v1/chat/completions", platformchannels.PlaceholderSecret)
	if err != nil || key != platformchannels.PlaceholderSecret {
		t.Fatalf("placeholder escaped configured origin: %q err=%v", key, err)
	}
}

func TestServiceProtocolRegistryKeepsHostBuiltinsWithPackagedCatalog(t *testing.T) {
	service := &Service{}
	registry := service.protocolRegistry()
	if _, ok := registry.Resolve("midjourney"); !ok {
		t.Fatal("midjourney host protocol disappeared from the service registry")
	}
	if _, ok := registry.Resolve("chat-completion"); !ok {
		t.Fatal("chat-completion host protocol disappeared from the service registry")
	}
}
