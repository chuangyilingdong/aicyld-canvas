package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/platformchannels"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

func TestWorkspaceModelConfigInjectsPlatformChannelsWithPlaceholder(t *testing.T) {
	router, _, dir, platformStore := newPlatformWorkspaceRouter(t)
	if _, err := platformStore.SaveAll([]platformchannels.Channel{{
		ID: "seedance", Name: "Platform Video", BaseURL: "https://platform.example", APIKey: "real-platform-secret",
		APIFormat: "openai", Enabled: true, Models: []string{"video-model"},
		ModelProfiles: []platformchannels.ModelProfile{{Model: "video-model", DisplayName: "Video", Capability: "video", Protocol: "newapi"}},
	}}, nil, map[string]string{"video.t2v": "aicyld-seedance::video-model"}); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/workspace/model-config", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if bytes.Contains(recorder.Body.Bytes(), []byte("real-platform-secret")) {
		t.Fatalf("platform credential leaked: %s", recorder.Body.String())
	}
	data := modelConfigResponseData(t, recorder)
	config, _ := data["config"].(map[string]any)
	channels, _ := config["channels"].([]any)
	if len(channels) < 2 {
		t.Fatalf("platform channel was not merged: %#v", channels)
	}
	platformChannel, ok := channels[0].(map[string]any)
	if !ok || platformChannel["id"] != "aicyld-seedance" {
		t.Fatalf("platform channel must be first: %#v", channels)
	}
	if platformChannel["apiKey"] != platformchannels.PlaceholderSecret || platformChannel["credentialRef"] != platformchannels.CredentialRef {
		t.Fatalf("platform placeholder missing: %#v", platformChannel)
	}
	features, _ := data["featureModels"].(map[string]any)
	if features["video.t2v"] != "aicyld-seedance::video-model" {
		t.Fatalf("featureModels = %#v", features)
	}
	if filepath := dir; filepath == "" {
		t.Fatal("test data directory is empty")
	}
}

func TestWorkspaceModelConfigPutStripsPlatformChannelCopies(t *testing.T) {
	router, providerStore, _, _ := newPlatformWorkspaceRouter(t)
	body, err := json.Marshal(map[string]any{
		"expectedRevision": 0,
		"config": map[string]any{"channels": []any{
			map[string]any{"id": "aicyld-stale", "apiKey": "system", "credentialRef": platformchannels.CredentialRef, "enabled": true},
			map[string]any{"id": "beefapi", "apiKey": "local-secret", "enabled": true},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/workspace/model-config", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	raw, err := providerStore.ReadLocalModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "aicyld-stale") || strings.Contains(string(raw), `"credentialRef"`) {
		t.Fatalf("platform copy reached disk: %s", raw)
	}
}

func TestWorkspaceModelConfigPutRejectsHostedNonAdmin(t *testing.T) {
	t.Setenv("AICYLD_SSO_SECRET", "test-only-sso-secret")
	router, _, _, _ := newPlatformWorkspaceRouter(t)
	body := bytes.NewBufferString(`{"expectedRevision":0,"config":{"channels":[{"id":"beefapi","apiKey":"must-not-write","enabled":true}]}}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/workspace/model-config", body)
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if bytes.Contains(recorder.Body.Bytes(), []byte("must-not-write")) {
		t.Fatalf("write credential leaked: %s", recorder.Body.String())
	}
}

func newPlatformWorkspaceRouter(t *testing.T) (*gin.Engine, *workspace.ProviderConfig, string, *platformchannels.Store) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	providerStore, err := workspace.NewProviderConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	platformStore, err := platformchannels.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	service := app.NewLocal(nil, dir)
	router := gin.New()
	router.Use(WorkspaceMiddleware(workspace.Context{ID: "local", DataDir: dir}))
	router.Use(RuntimeDependenciesMiddleware(RuntimeDependencies{ProviderConfig: providerStore}))
	RegisterWorkspaceRoutes(router.Group("/api"), service)
	return router, providerStore, dir, platformStore
}
