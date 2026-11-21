package handler

import (
	"bytes"
	"context"
	"image"
	_ "image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/testutil"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestResourceVideoPosterReturnsCachedJPEG(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg unavailable")
	}
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dataDir, "test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	testutil.CloseDBOnCleanup(t, db)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	service := app.NewLocal(repository.New(db), dataDir)
	owner, err := service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(dataDir, "resources", "poster-video.mp4")
	if err := os.MkdirAll(filepath.Dir(source), 0o755); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(context.Background(), ffmpeg,
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=320x180:d=0.5",
		"-c:v", "mpeg4", "-pix_fmt", "yuv420p", source,
	)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		t.Fatalf("create video: %v: %s", err, stderr.String())
	}
	resource := model.Resource{
		ID: "poster-video", UserID: owner.ID, Kind: "video", MimeType: "video/mp4",
		Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "poster-video.mp4",
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.PlaybackService().Poster(owner.ID, resource.ID, 240); err != nil {
		t.Fatalf("prepare poster: %v", err)
	}
	router := gin.New()
	RegisterUserDataRoutes(router.Group("/api"), service, service.CanvasService(), service.PromptService(), service.AssetLibraryService(), service.ResourceService(), service.PlaybackService(), service, service, service)
	request := httptest.NewRequest(http.MethodGet, "/api/resources/poster-video/file?proxy=1&thumbnail=240", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("poster status = %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("poster content-type = %q", response.Header().Get("Content-Type"))
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(response.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if config.Width != 240 || config.Height < 134 || config.Height > 136 {
		t.Fatalf("poster dimensions = %dx%d, want 240x135-ish", config.Width, config.Height)
	}
	etag := response.Header().Get("ETag")
	if etag == "" {
		t.Fatal("poster ETag is empty")
	}
	request = httptest.NewRequest(http.MethodGet, "/api/resources/poster-video/file?proxy=1&thumbnail=240", nil)
	request.Header.Set("If-None-Match", etag)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotModified {
		t.Fatalf("cached poster status = %d", response.Code)
	}
}
