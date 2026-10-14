package handler

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

// workspaceUnresolvedKey 记录本次请求解析工作区失败的原因，便于日志与诊断。
const workspaceUnresolvedKey = "canvas.workspace_error"

// WorkspaceUserResolver 把主站身份幂等映射为画布用户。
type WorkspaceUserResolver func(identity SSOIdentity) (*model.User, error)

// WorkspaceResolverMiddleware 按请求解析工作区归属。
//
//   - 未配置 AICYLD_SSO_SECRET：始终使用 fallback，保持上游「一个安装一个工作区」的行为。
//   - 已配置：公开路径（健康检查、公开分享）放行到 fallback；
//     其余请求必须携带有效主站会话，否则 401（前端据此跳转主站登录）。
//
// 解析结果写入 workspaceContextKey，后续 handler 通过 currentUser 读取，
// 业务层所有表都按 user_id 过滤，因此天然按用户隔离。
func WorkspaceResolverMiddleware(dataDir string, fallback workspace.Context, resolve WorkspaceUserResolver) gin.HandlerFunc {
	cache := newWorkspaceResolverCache()
	return func(c *gin.Context) {
		if !SSOConfigured() {
			c.Set(workspaceContextKey, fallback)
			c.Next()
			return
		}
		if workspacePublicAPIPath(c.Request.URL.Path) {
			c.Set(workspaceContextKey, fallback)
			c.Next()
			return
		}

		identity, err := ParseSSOCookie(c)
		if err != nil {
			c.Set(workspaceUnresolvedKey, err.Error())
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code": http.StatusUnauthorized,
				"data": nil,
				"msg":  "请先登录创易灵动账号",
			})
			return
		}

		userID, err := cache.resolve(identity, resolve)
		if err != nil {
			c.Set(workspaceUnresolvedKey, err.Error())
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"code": http.StatusInternalServerError,
				"data": nil,
				"msg":  "工作区初始化失败",
			})
			return
		}

		scope := workspace.Context{ID: userID, DataDir: dataDir}
		if err := scope.Validate(); err != nil {
			c.Set(workspaceUnresolvedKey, err.Error())
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"code": http.StatusInternalServerError,
				"data": nil,
				"msg":  "工作区上下文不合法",
			})
			return
		}
		c.Set(workspaceContextKey, scope)
		c.Next()
	}
}

// workspacePublicAPIPath 列出无需主站会话即可访问的 API 前缀。
func workspacePublicAPIPath(path string) bool {
	return strings.HasPrefix(path, "/api/health") || strings.HasPrefix(path, "/api/public/")
}

const (
	workspaceResolverCacheTTL = 10 * time.Minute
	workspaceResolverCacheMax = 5000
)

type workspaceResolverCacheEntry struct {
	userID    string
	expiresAt time.Time
}

// workspaceResolverCache 缓存「主站用户 ID → 画布用户 ID」，避免每次请求都读写数据库。
type workspaceResolverCache struct {
	mu      sync.RWMutex
	entries map[string]workspaceResolverCacheEntry
}

func newWorkspaceResolverCache() *workspaceResolverCache {
	return &workspaceResolverCache{entries: make(map[string]workspaceResolverCacheEntry)}
}

func (c *workspaceResolverCache) resolve(identity *SSOIdentity, resolve WorkspaceUserResolver) (string, error) {
	c.mu.RLock()
	entry, ok := c.entries[identity.UserID]
	c.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.userID, nil
	}

	user, err := resolve(*identity)
	if err != nil {
		return "", err
	}

	c.mu.Lock()
	if len(c.entries) >= workspaceResolverCacheMax {
		c.entries = make(map[string]workspaceResolverCacheEntry)
	}
	c.entries[identity.UserID] = workspaceResolverCacheEntry{
		userID:    user.ID,
		expiresAt: time.Now().Add(workspaceResolverCacheTTL),
	}
	c.mu.Unlock()
	return user.ID, nil
}
