package handler

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/testutil"
)

func TestExternalGuardrailRoutesAreOwnerScopedAndDefaultClosed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "guardrail-routes.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	testutil.CloseDBOnCleanup(t, db)
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Workspace{ID: "local", Name: "本地工作区"}).Error; err != nil {
		t.Fatal(err)
	}
	service := app.NewLocal(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = service.Close() })
	router := gin.New()
	RegisterExternalGuardrailRoutes(router.Group("/api"), service, func(*http.Request) bool { return true })

	call := func(method, body string, headers map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:18090/api/agent-clients/guardrails", strings.NewReader(body))
		req.Host = "127.0.0.1:18090"
		req.RemoteAddr = "127.0.0.1:12345"
		req.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	initial := call(http.MethodGet, "", nil)
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"mode":"propose_only"`) || !strings.Contains(initial.Body.String(), `"todaySpentCny":0`) {
		t.Fatalf("initial guardrail: %d %s", initial.Code, initial.Body.String())
	}
	updated := call(http.MethodPut, `{"mode":"allow","maxPerCallCny":8.5,"dailyBudgetCny":30}`, nil)
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), `"mode":"allow"`) || !strings.Contains(updated.Body.String(), `"dailyBudgetCny":30`) {
		t.Fatalf("updated guardrail: %d %s", updated.Code, updated.Body.String())
	}
	blocked := call(http.MethodGet, "", map[string]string{"X-Beeftv-Client": "external"})
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("external client read guardrail: %d %s", blocked.Code, blocked.Body.String())
	}
}
