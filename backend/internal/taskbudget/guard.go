package taskbudget

import (
	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Guard prevents tasks from being created for archived batches.
type Guard struct {
	Repo    *repository.Repository
	Billing *billing.Client
}

func New(repo *repository.Repository, client *billing.Client) Guard {
	return Guard{Repo: repo, Billing: client}
}

func (g Guard) Check(userID string, task *model.Task) error {
	if g.Repo == nil || g.Billing == nil || !g.Billing.Enabled() || task == nil {
		return nil
	}
	batch, err := g.Repo.SmartFilmBatchForTask(task)
	if err != nil {
		return err
	}
	if batch == nil {
		return nil
	}
	if batch.Status == "archived" {
		return kernel.BadAuthRequest("批次已归档，不能创建新的生成任务")
	}
	return nil
}
