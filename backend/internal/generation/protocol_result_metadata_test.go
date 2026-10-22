package generation

import (
	"context"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func TestFinishProtocolResultKeepsProviderMetadata(t *testing.T) {
	result := &protocol.Result{
		Images: []protocol.MediaReference{{
			DataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		}},
		ProviderMetadata: map[string]any{
			"midjourneyButtons": []map[string]any{{"customId": "MJ::JOB::upsample::1::token", "label": "U1"}},
		},
	}
	output, err := FinishProtocolResult(context.Background(), Config{}, "image", "mj-task", result, DefaultVideoPollPolicy())
	if err != nil {
		t.Fatal(err)
	}
	metadata, ok := output["providerMetadata"].(map[string]any)
	if !ok || len(metadata) == 0 || metadata["midjourneyButtons"] == nil {
		t.Fatalf("provider metadata lost: %#v", output)
	}
}
