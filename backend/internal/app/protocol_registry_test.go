package app

import (
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func TestEnsureHostBuiltinProtocolRegistersMidjourney(t *testing.T) {
	registry, err := protocol.NewRegistry()
	if err != nil {
		t.Fatal(err)
	}
	ensureHostBuiltinProtocol(registry, "midjourney")
	adapter, ok := registry.Resolve("midjourney")
	if !ok || !protocolUsesCapability(adapter.Metadata(), protocol.CapabilityImage) {
		t.Fatalf("Midjourney was not registered: %#v", adapter)
	}
	ensureHostBuiltinProtocol(registry, "midjourney")
}

func protocolUsesCapability(metadata protocol.Metadata, want protocol.Capability) bool {
	for _, capability := range metadata.Categories {
		if capability == want {
			return true
		}
	}
	return false
}
