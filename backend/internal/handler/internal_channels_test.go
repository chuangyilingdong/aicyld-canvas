package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/canvas"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/platformchannels"
	"infinite-canvas/backend/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
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

func TestInternalCanvasSettingsReadAndUpdate(t *testing.T) {
	t.Setenv("AICYLD_CANVAS_INTERNAL_TOKEN", "test-internal-token")
	t.Setenv("CANVAS_OSS_ENDPOINT", "oss-cn-test.aliyuncs.com")
	t.Setenv("CANVAS_OSS_BUCKET", "canvas-test")
	t.Setenv("CANVAS_OSS_ACCESS_KEY", "access-key")
	t.Setenv("CANVAS_OSS_SECRET_KEY", "secret-key")
	t.Setenv("CANVAS_OSS_PATH_PREFIX", "canvas/")
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://hb.example.test")
	t.Setenv("CANVAS_OSS_LOCAL_RETENTION_HOURS", "48")
	t.Cleanup(func() { canvas.SetEffectiveCanvasDocumentLimitMB(canvas.DefaultCanvasDocumentLimitMB) })
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	service := app.NewLocal(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterInternalChannelRoutes(router.Group("/api"), service)

	get := httptest.NewRequest(http.MethodGet, "/api/internal/canvas-settings", nil)
	get.Header.Set(internalChannelTokenHeader, "test-internal-token")
	getRecorder := httptest.NewRecorder()
	router.ServeHTTP(getRecorder, get)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("get status = %d body=%s", getRecorder.Code, getRecorder.Body.String())
	}
	if bytes.Contains(getRecorder.Body.Bytes(), []byte("secret-key")) {
		t.Fatalf("canvas settings leaked storage secret: %s", getRecorder.Body.String())
	}
	var getEnvelope struct {
		Data struct {
			CanvasDocumentMB int64 `json:"canvasDocumentMB"`
			Storage          struct {
				Configured bool `json:"configured"`
			} `json:"storage"`
		} `json:"data"`
	}
	if err := json.Unmarshal(getRecorder.Body.Bytes(), &getEnvelope); err != nil {
		t.Fatal(err)
	}
	if getEnvelope.Data.CanvasDocumentMB != canvas.DefaultCanvasDocumentLimitMB || !getEnvelope.Data.Storage.Configured {
		t.Fatalf("unexpected canvas settings: %+v", getEnvelope.Data)
	}

	body, _ := json.Marshal(map[string]any{"canvasDocumentMB": 128})
	patch := httptest.NewRequest(http.MethodPatch, "/api/internal/canvas-settings", bytes.NewReader(body))
	patch.Header.Set("Content-Type", "application/json")
	patch.Header.Set(internalChannelTokenHeader, "test-internal-token")
	patchRecorder := httptest.NewRecorder()
	router.ServeHTTP(patchRecorder, patch)
	if patchRecorder.Code != http.StatusOK || !bytes.Contains(patchRecorder.Body.Bytes(), []byte(`"canvasDocumentMB":128`)) {
		t.Fatalf("patch status = %d body=%s", patchRecorder.Code, patchRecorder.Body.String())
	}

	tooLarge, _ := json.Marshal(map[string]any{"canvasDocumentMB": 513})
	invalid := httptest.NewRequest(http.MethodPatch, "/api/internal/canvas-settings", bytes.NewReader(tooLarge))
	invalid.Header.Set("Content-Type", "application/json")
	invalid.Header.Set(internalChannelTokenHeader, "test-internal-token")
	invalidRecorder := httptest.NewRecorder()
	router.ServeHTTP(invalidRecorder, invalid)
	if invalidRecorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid status = %d body=%s", invalidRecorder.Code, invalidRecorder.Body.String())
	}
}
