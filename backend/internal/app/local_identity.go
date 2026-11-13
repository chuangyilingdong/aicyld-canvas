package app

import (
	"errors"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/workspace"
)

// AuthUser is retained as a response-shape compatibility type. Local mode has
// no session or external identity provider.
type AuthUser struct {
	model.User
	AvatarURL        string `json:"avatarUrl,omitempty"`
	IdentityProvider string `json:"identityProvider,omitempty"`
	IdentityID       string `json:"identityId,omitempty"`
	IdentityUsername string `json:"identityUsername,omitempty"`
}

func (s *Service) WorkspaceIdentity() *workspace.Service {
	if s == nil || s.repo == nil {
		return workspace.NewService(nil)
	}
	return workspace.NewService(s.repo)
}

func (s *Service) LocalWorkspaceOwner() (*model.User, error) {
	return s.WorkspaceIdentity().LocalWorkspaceOwner()
}

func (s *Service) WorkspaceOwner(id string) (*model.User, error) {
	return s.WorkspaceIdentity().WorkspaceOwner(id)
}

// EnsureWorkspaceUser 幂等确保主站身份在画布侧存在独立工作区，并返回其工作区主体。
// 开源版没有 users 表：工作区行即用户，返回值的 ID 同时是所有业务数据的 user_id。
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

func (s *Service) PublicAuthUser(user *model.User) (AuthUser, error) {
	if user == nil {
		return AuthUser{}, Unauthorized("本地工作区尚未初始化")
	}
	return AuthUser{User: *user}, nil
}
