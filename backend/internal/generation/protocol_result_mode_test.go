package generation

import (
	"context"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func TestProtocolResultModeRoutesMidjourneyActions(t *testing.T) {
	tests := []struct {
		action string
		want   string
	}{
		{"describe", "text"},
		{"video", "video"},
		{"upscale", "image"},
	}
	for _, test := range tests {
		input := Input{
			Mode:   "image",
			Config: Config{InterfaceType: "midjourney"},
			Metadata: map[string]any{
				"midjourney": map[string]any{"action": test.action},
			},
		}
		if got := ProtocolResultMode(input); got != test.want {
			t.Fatalf("action=%s mode=%s want=%s", test.action, got, test.want)
		}
	}
}

func TestFinishMidjourneyDescribeReturnsTextMode(t *testing.T) {
	input := Input{
		Mode:   "image",
		Config: Config{InterfaceType: "midjourney"},
		Metadata: map[string]any{
			"midjourney": map[string]any{"action": "describe"},
		},
	}
	output, err := FinishProtocolAdapterResult(context.Background(), input, nil, protocol.GenerationRequest{}, "task-mj-describe", &protocol.Result{Text: "a quiet forest at dawn"}, DefaultVideoPollPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if output["mode"] != "text" || output["text"] != "a quiet forest at dawn" {
		t.Fatalf("output=%#v", output)
	}
}

func TestFinishMidjourneyVideoReturnsVideoMode(t *testing.T) {
	input := Input{
		Mode:   "image",
		Config: Config{InterfaceType: "midjourney"},
		Metadata: map[string]any{
			"midjourney": map[string]any{"action": "video"},
		},
	}
	output, err := FinishProtocolAdapterResult(context.Background(), input, nil, protocol.GenerationRequest{}, "task-mj-video", &protocol.Result{
		Videos: []protocol.MediaReference{{DataURL: "data:video/mp4;base64,AAAA", MIMEType: "video/mp4"}},
	}, DefaultVideoPollPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if output["mode"] != "video" || output["video"] == nil {
		t.Fatalf("output=%#v", output)
	}
}
