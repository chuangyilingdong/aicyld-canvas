package handler

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestSignedPublicResourceRouteServesLocalResourceAndRejectsInvalidSignature(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://8.134.120.22")
	dataDir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dataDir, "public-resource.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := app.NewLocal(repository.New(db), dataDir)
	owner, err := svc.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("public-resource-bytes")
	resource := model.Resource{
		ID: "public-resource", UserID: owner.ID, Kind: "image", MimeType: "image/png",
		Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "public-resource.png", Size: int64(len(payload)),
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "resources"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "resources", resource.ObjectKey), payload, 0o644); err != nil {
		t.Fatal(err)
	}

	router := gin.New()
	RegisterUserDataRoutes(router.Group("/api"), svc, svc.CanvasService(), svc.PromptService(), svc.AssetLibraryService(), svc.ResourceService(), svc.PlaybackService(), svc, svc, svc)
	signed, err := svc.DirectResourceURL(owner.ID, resource.ID)
	if err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, signed, nil))
	if response.Code != http.StatusOK || response.Body.String() != string(payload) {
		t.Fatalf("signed public resource = %d %q", response.Code, response.Body.String())
	}

	parsed, err := url.Parse(signed)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("signature", "invalid")
	parsed.RawQuery = query.Encode()
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, parsed.String(), nil))
	if response.Code != http.StatusForbidden {
		t.Fatalf("invalid signature status = %d, want 403: %s", response.Code, response.Body.String())
	}

	request := httptest.NewRequest(http.MethodGet, signed, nil)
	request.Header.Set("Range", "bytes=0-5")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "public" {
		t.Fatalf("signed public range = %d %q", response.Code, response.Body.String())
	}
}
