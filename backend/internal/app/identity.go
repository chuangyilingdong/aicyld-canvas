package app

import (
	"errors"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/workspace"
)

// EnsureWorkspaceUser 幂等确保主站身份在画布侧存在独立工作区，并返回其工作区主体。
//
// 开源版没有 users 表：工作区行即"用户"（见 workspace.LocalPrincipal）。
// 首登创建、之后读回；返回值的 ID 就是工作区 ID，也是所有业务数据的 user_id。
func (s *Service) EnsureWorkspaceUser(mainSiteUserID string, username string, displayName string) (*model.User, error) {
	if s == nil || s.repo == nil {
		return nil, errors.New("服务未初始化")
	}
	name := displayName
	if name == "" {
		name = username
	}
	value, err := s.repo.EnsureWorkspace(mainSiteUserID, name)
	if err != nil {
		return nil, err
	}
	principal := workspace.LocalPrincipal(value)
	if principal == nil {
		return nil, errors.New("工作区主体解析失败")
	}
	return principal, nil
}
