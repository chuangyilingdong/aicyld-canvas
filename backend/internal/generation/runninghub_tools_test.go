package generation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestRecoverRunningHubManagedImageUpscaleQueriesOnlyOriginalTask(t *testing.T) {
	var createCalls atomic.Int32
	var queryCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/openapi/v2/topazlabs/image-upscale-standard-v2":
			createCalls.Add(1)
			http.Error(w, "recovery must never create", http.StatusInternalServerError)
		case "/openapi/v2/query":
			queryCalls.Add(1)
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["taskId"] != "original-task" {
				t.Fatalf("query task id = %q", body["taskId"])
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"taskId":"original-task","status":"PROCESSING"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	ctx, cancel := context.WithTimeout(WithRuntime(context.Background(), Runtime{
		Call: CallMeta{UserID: "owner"},
	}), 5*time.Second)
	defer cancel()
	input := Input{
		Mode: "image",
		Config: Config{
			ChannelID: "runninghub-ai", ChannelModelKey: "topaz",
			ProviderModelKey: RunningHubImageUpscaleEndpoint,
			InterfaceType:    string(model.ChannelInterfaceRunningHubStandardImage),
			BaseURL:          provider.URL, Model: "topaz",
		},
		Upscale: &UpscaleOptions{Factor: 2},
		ReferenceImages: []Media{{
			StorageKey: "resource:source-image", Width: 1024, Height: 1024, MimeType: "image/png",
		}},
	}
	result, status, err := RecoverUpscaleResult(ctx, input, "original-task")
	if err != nil {
		t.Fatal(err)
	}
	if result != nil || status != "processing" {
		t.Fatalf("recovery result=%#v status=%q", result, status)
	}
	if createCalls.Load() != 0 || queryCalls.Load() != 1 {
		t.Fatalf("recovery submitted a new task: create=%d query=%d", createCalls.Load(), queryCalls.Load())
	}
}

func TestRunningHubManagedToolEndpointMustMatchFrozenOperation(t *testing.T) {
	for _, input := range []Input{
		{
			Mode: "video",
			Config: Config{
				InterfaceType: string(model.ChannelInterfaceRunningHubStandardVideo),
				Model:         RunningHubSubtitleEraseEndpoint,
			},
			Upscale: &UpscaleOptions{Factor: 2},
		},
		{
			Mode: "image",
			Config: Config{
				InterfaceType: string(model.ChannelInterfaceRunningHubStandardImage),
				Model:         RunningHubImageUpscaleEndpoint,
			},
		},
	} {
		if IsRunningHubManagedMediaTool(input) {
			t.Fatalf("inconsistent frozen operation accepted: %+v", input)
		}
	}
}
