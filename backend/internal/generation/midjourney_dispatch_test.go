package generation

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRunImageTaskLoadsMidjourneyBuiltinWithoutRegistry(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nQAAAABJRU5ErkJggg=="
	var createPath string
	var createBody map[string]any
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/midjourney/generations/imagine":
			createPath = r.URL.Path
			_ = json.NewDecoder(r.Body).Decode(&createBody)
			_, _ = w.Write([]byte(`{"task_id":"mj-task-1","status":"pending"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/midjourney/tasks/mj-task-1":
			_, _ = w.Write([]byte(`{"task_id":"mj-task-1","status":"SUCCESS","grid_image_url":"` + serverURL + `/result.png"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/result.png":
			w.Header().Set("Content-Type", "image/png")
			data, _ := base64.StdEncoding.DecodeString(pngBase64)
			_, _ = w.Write(data)
		default:
			http.NotFound(w, r)
		}
	}))
	serverURL = server.URL
	defer server.Close()

	result, err := RunImageTask(context.Background(), Input{
		Mode:   "image",
		Prompt: "a red apple",
		Config: Config{
			BaseURL:       server.URL + "/v1",
			APIKey:        "test-key",
			InterfaceType: "midjourney",
			Model:         "midjourney-imagine",
			Size:          "1:1",
			Quality:       "fast",
		},
		Metadata: map[string]any{"midjourney": map[string]any{"action": "imagine"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if createPath != "/v1/midjourney/generations/imagine" {
		t.Fatalf("create path = %q", createPath)
	}
	if createBody["model"] != "midjourney" || createBody["prompt"] != "a red apple" {
		t.Fatalf("create body = %#v", createBody)
	}
	images, _ := result["images"].([]any)
	if len(images) != 1 {
		t.Fatalf("result = %#v", result)
	}
}
