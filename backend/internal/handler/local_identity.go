package handler

import (
	"infinite-canvas/backend/internal/model"

	"github.com/gin-gonic/gin"
)

// workspaceOwners is the only capability handlers need to resolve the caller.
type workspaceOwners interface {
	WorkspaceOwner(string) (*model.User, error)
	LocalWorkspaceOwner() (*model.User, error)
}

// currentUser resolves the stable workspace owner. Local routes never inspect
// cookies and never create a session record.
func currentUser(c *gin.Context, svc workspaceOwners) (*model.User, error) {
	if _, exists := c.Get(workspaceContextKey); exists {
		scope, err := CurrentWorkspace(c)
		if err != nil {
			return nil, err
		}
		user, err := svc.WorkspaceOwner(scope.ID)
		if err != nil {
			return nil, err
		}
		return applyHostedRole(c, user), nil
	}
	user, err := svc.LocalWorkspaceOwner()
	if err != nil {
		return nil, err
	}
	return applyHostedRole(c, user), nil
}

// applyHostedRole 在启用主站登录后收紧权限。上游把每个工作区主体都视为管理员，
// 托管形态下默认降级为普通用户，只有 AICYLD_CANVAS_ADMIN_IDS 白名单保留管理员角色。
func applyHostedRole(c *gin.Context, user *model.User) *model.User {
	if user == nil || !SSOConfigured() {
		return user
	}
	if isAdmin, ok := c.Get(workspaceAdminKey); ok {
		if allowed, isBool := isAdmin.(bool); isBool && allowed {
			return user
		}
	}
	clone := *user
	clone.Role = model.UserRoleUser
	return &clone
}
