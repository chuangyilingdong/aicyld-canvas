package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/platformchannels"

	"github.com/gin-gonic/gin"
)

func TestInternalChannelsRequiresServerTokenAndRedactsSecrets(t *testing.T) {
	t.Setenv("AICYLD_CANVAS_INTERNAL_TOKEN", "test-internal-token")
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	service := app.NewLocal(nil, dir)
	router := gin.New()
	RegisterInternalChannelRoutes(router.Group("/api"), service)

	unauthorized := httptest.NewRecorder()
	router.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/internal/channels", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d body=%s", unauthorized.Code, unauthorized.Body.String())
	}

	payload, err := json.Marshal(map[string]any{
		"channels": []any{map[string]any{
			"id": "sync-test", "name": "Sync Test", "baseUrl": "https://platform.example", "apiKey": "platform-secret",
			"apiFormat": "openai", "enabled": true,
			"models":        []string{"text-model"},
			"modelProfiles": []any{map[string]any{"model": "text-model", "capability": "text", "protocol": "chat-completion"}},
		}},
		"assistantModel": "sync-test::text-model",
		"featureModels":  map[string]string{"text.chat": "sync-test::text-model"},
	})
	if err != nil {
		t.Fatal(err)
	}
	put := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/internal/channels", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(internalChannelTokenHeader, "test-internal-token")
	router.ServeHTTP(put, request)
	if put.Code != http.StatusOK {
		t.Fatalf("put status = %d body=%s", put.Code, put.Body.String())
	}
	if bytes.Contains(put.Body.Bytes(), []byte("platform-secret")) {
		t.Fatalf("internal response leaked platform secret: %s", put.Body.String())
	}
	var envelope struct {
		Data struct {
			Channels []platformchannels.Channel `json:"channels"`
		} `json:"data"`
	}
	if err := json.Unmarshal(put.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Data.Channels) != 1 || envelope.Data.Channels[0].APIKey != platformchannels.MaskedSecret {
		t.Fatalf("redacted channels = %#v", envelope.Data.Channels)
	}
	if !bytes.Contains(put.Body.Bytes(), []byte(`"warnings"`)) {
		t.Fatalf("missing mirror warnings: %s", put.Body.String())
	}
}

func TestInternalChannelsUnavailableWithoutConfiguredToken(t *testing.T) {
	t.Setenv("AICYLD_CANVAS_INTERNAL_TOKEN", "")
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterInternalChannelRoutes(router.Group("/api"), app.NewLocal(nil, t.TempDir()))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/internal/channels", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}
