package skills

import (
	"context"

	"infinite-canvas/backend/internal/repository"
)

// Service 是技能域入口。组合根注入仓库、数据目录和后台循环，禁止 import internal/app。
type Service struct {
	repo          *repository.Repository
	dataDir       string
	runWorkerLoop func(func(context.Context)) bool
	localSource   bool
	scriptState   *scriptRuntimeState
}

func New(repo *repository.Repository, dataDir string, runWorkerLoop func(func(context.Context)) bool) *Service {
	if runWorkerLoop == nil {
		runWorkerLoop = func(func(context.Context)) bool { return false }
	}
	return &Service{
		repo:          repo,
		dataDir:       dataDir,
		runWorkerLoop: runWorkerLoop,
		scriptState:   newScriptRuntimeState(),
	}
}

func (s *Service) WithRepo(repo *repository.Repository) *Service {
	if s == nil {
		return New(repo, "", nil)
	}
	clone := *s
	clone.repo = repo
	if clone.scriptState == nil {
		clone.scriptState = newScriptRuntimeState()
	}
	return &clone
}

// SetLocalSourceEnabled controls whether this runtime may read the host user's
// shared ~/.agents/skills directory. Hosted multi-user servers must leave it off.
func (s *Service) SetLocalSourceEnabled(enabled bool) {
	if s != nil {
		s.localSource = enabled
	}
}
