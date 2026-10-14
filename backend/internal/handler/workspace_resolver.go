package handler

import (
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

// workspaceUnresolvedKey 记录本次请求解析工作区失败的原因，便于日志与诊断。
const workspaceUnresolvedKey = "canvas.workspace_error"

// workspaceAdminKey 记录本次请求的主站身份是否为画布管理员。
const workspaceAdminKey = "canvas.workspace_admin"

// workspaceIdentityKey 保存本次请求的主站身份，供 bootstrap 输出用户名与头像。
const workspaceIdentityKey = "canvas.workspace_identity"

// WorkspaceIdentity 返回本次请求解析出的主站身份（本地/桌面形态下不存在）。
func WorkspaceIdentity(c *gin.Context) (SSOIdentity, bool) {
	value, exists := c.Get(workspaceIdentityKey)
	if !exists {
		return SSOIdentity{}, false
	}
	identity, ok := value.(SSOIdentity)
	return identity, ok
}

// hostedAdminList 解析 AICYLD_CANVAS_ADMIN_IDS（主站用户 ID，逗号分隔）。
func hostedAdminList() map[string]struct{} {
	result := map[string]struct{}{}
	for _, part := range strings.Split(os.Getenv("AICYLD_CANVAS_ADMIN_IDS"), ",") {
		id := strings.TrimSpace(part)
		if id != "" {
			result[id] = struct{}{}
		}
	}
	return result
}

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
		c.Set(workspaceIdentityKey, *identity)
		if _, isAdmin := hostedAdminList()[identity.UserID]; isAdmin {
			c.Set(workspaceAdminKey, true)
		}
		c.Set(workspaceContextKey, scope)
		c.Next()
	}
}

// hostedFeatureOverrides 在托管形态下收紧功能开关：模型渠道由平台统一维护，
// 画布内不再开放用户自定义渠道（前端据此隐藏渠道编辑与内部系统渠道）。
func hostedFeatureOverrides(setting *platform.PublicFeatureAvailability) *platform.PublicFeatureAvailability {
	if setting == nil || !SSOConfigured() {
		return setting
	}
	setting.CustomChannelsEnabled = false
	return setting
}

// workspacePublicAPIPath 列出无需主站会话即可访问的 API 前缀。
func workspacePublicAPIPath(path string) bool {
	return strings.HasPrefix(path, "/api/health") ||
		strings.HasPrefix(path, "/api/public/") ||
		// 内部管理接口自带共享密钥鉴权，不依赖主站会话。
		strings.HasPrefix(path, "/api/internal/")
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
