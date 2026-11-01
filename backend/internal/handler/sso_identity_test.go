package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

func testSSOToken(t *testing.T, secret string, header map[string]any, payload map[string]any) string {
	t.Helper()
	encode := func(value any) string {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(data)
	}
	headerPart := encode(header)
	payloadPart := encode(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(headerPart + "." + payloadPart))
	return headerPart + "." + payloadPart + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestVerifySSOTokenRejectsInvalidIdentity(t *testing.T) {
	validPayload := map[string]any{"uid": "main-user", "uname": "alice", "name": "Alice", "exp": int64(4102444800)}
	token := testSSOToken(t, "secret", map[string]any{"alg": "HS256"}, validPayload)
	identity, err := verifySSOToken(token, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if identity.UserID != "main-user" || identity.Username != "alice" || identity.DisplayName != "Alice" {
		t.Fatalf("unexpected identity: %+v", identity)
	}

	cases := []struct {
		name    string
		token   string
		secret  string
		wantErr error
	}{
		{name: "wrong secret", token: token, secret: "other", wantErr: ErrSSOInvalid},
		{name: "wrong algorithm", token: testSSOToken(t, "secret", map[string]any{"alg": "none"}, validPayload), secret: "secret", wantErr: ErrSSOInvalid},
		{name: "expired", token: testSSOToken(t, "secret", map[string]any{"alg": "HS256"}, map[string]any{"uid": "main-user", "exp": int64(1)}), secret: "secret", wantErr: ErrSSOExpired},
		{name: "local user", token: testSSOToken(t, "secret", map[string]any{"alg": "HS256"}, map[string]any{"uid": "local"}), secret: "secret", wantErr: ErrSSOInvalid},
		{name: "empty user", token: testSSOToken(t, "secret", map[string]any{"alg": "HS256"}, map[string]any{"uid": ""}), secret: "secret", wantErr: ErrSSOInvalid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := verifySSOToken(tc.token, tc.secret); !errors.Is(err, tc.wantErr) {
				t.Fatalf("error=%v want=%v", err, tc.wantErr)
			}
		})
	}
}

func TestWorkspaceResolverMiddlewareRequiresSSOOutsidePublicPaths(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("AICYLD_SSO_SECRET", "secret")
	fallback := workspace.Context{ID: "fallback", DataDir: t.TempDir()}
	resolver := func(identity SSOIdentity) (*model.User, error) {
		return &model.User{ID: "workspace-" + identity.UserID}, nil
	}
	router := gin.New()
	router.Use(WorkspaceResolverMiddleware(fallback.DataDir, fallback, resolver, nil))
	router.GET("/api/test", func(c *gin.Context) {
		scope, err := CurrentWorkspace(c)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"workspace": scope.ID})
	})
	router.GET("/api/health", func(c *gin.Context) {
		scope, err := CurrentWorkspace(c)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"workspace": scope.ID})
	})

	request := func(path string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}

	if got := request("/api/test", nil); got.Code != http.StatusUnauthorized {
		t.Fatalf("missing cookie status=%d body=%s", got.Code, got.Body.String())
	}
	token := testSSOToken(t, "secret", map[string]any{"alg": "HS256"}, map[string]any{"uid": "main-user", "exp": int64(4102444800)})
	got := request("/api/test", &http.Cookie{Name: SSOCookieName, Value: token})
	if got.Code != http.StatusOK || got.Body.String() != "{\"workspace\":\"workspace-main-user\"}" {
		t.Fatalf("valid cookie status=%d body=%s", got.Code, got.Body.String())
	}
	if got := request("/api/health", nil); got.Code != http.StatusOK || got.Body.String() != "{\"workspace\":\"fallback\"}" {
		t.Fatalf("public path status=%d body=%s", got.Code, got.Body.String())
	}
}

func TestApplyHostedRoleDowngradesNonWhitelistedUsers(t *testing.T) {
	t.Setenv("AICYLD_SSO_SECRET", "secret")
	user := &model.User{ID: "workspace", Role: model.UserRoleAdmin}
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	if got := applyHostedRole(context, user); got.Role != model.UserRoleUser {
		t.Fatalf("non-admin role=%s", got.Role)
	}
	context.Set(workspaceAdminKey, true)
	if got := applyHostedRole(context, user); got.Role != model.UserRoleAdmin {
		t.Fatalf("admin role=%s", got.Role)
	}
	if user.Role != model.UserRoleAdmin {
		t.Fatalf("original user mutated: %+v", user)
	}
}
