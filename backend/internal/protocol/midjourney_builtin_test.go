package protocol

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestMidjourneyBuiltinMapsImagineAndPollResults(t *testing.T) {
	adapter, ok := Builtins().Get("midjourney")
	if !ok {
		t.Fatal("Midjourney adapter missing")
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "midjourney-imagine", Prompt: "a red fox", AspectRatio: "16:9", Quality: "fast",
		Images: []MediaReference{{URL: "https://cdn.example/reference.png", Kind: "image"}},
		Extra: map[string]any{"midjourney": map[string]any{
			"action": "imagine", "quality": "1", "version": "8.1", "stylize": float64(750), "hd": true,
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != http.MethodPost || spec.Path != "/v1/midjourney/generations/imagine" {
		t.Fatalf("create spec = %#v", spec)
	}
	raw, _ := json.Marshal(spec.Body)
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body["model"] != "midjourney" || body["prompt"] != "a red fox" || body["size"] != "16:9" || body["speed"] != "fast" || body["quality"] != "1" || body["stylize"] != float64(750) || body["hd"] != true {
		t.Fatalf("create body = %#v", body)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "mj-1"})
	if err != nil || poll.Method != http.MethodGet || poll.Path != "/v1/midjourney/tasks/mj-1" {
		t.Fatalf("poll spec = %#v err=%v", poll, err)
	}
	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "mj-1"}, []byte(`{"task_id":"mj-1","status":"SUCCESS","image_urls":["https://cdn.example/a.png","https://cdn.example/b.png","https://cdn.example/c.png","https://cdn.example/d.png"],"buttons":[{"customId":"MJ::upsample::1","label":"U1"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 4 {
		t.Fatalf("poll result = %#v", result)
	}
	buttons, _ := result.Result.ProviderMetadata["midjourneyButtons"].([]map[string]any)
	if len(buttons) != 1 || buttons[0]["label"] != "U1" {
		t.Fatalf("buttons = %#v", result.Result.ProviderMetadata)
	}
}

func TestMidjourneyBuiltinKeepsVideoZeroIndex(t *testing.T) {
	adapter, _ := Builtins().Get("midjourney")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "midjourney-imagine",
		Extra: map[string]any{"midjourney": map[string]any{"action": "video", "taskId": "parent", "index": float64(0), "animateMode": "auto"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["index"] != 0 || body["task_id"] != "parent" {
		t.Fatalf("video body = %#v", body)
	}
}
