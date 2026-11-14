package taskbudget

import (
	"context"
	"fmt"

	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Guard enforces the optional batch budget at the task admission boundary.
// It uses the same persisted task snapshot as points reservation so custom
// frontend paths cannot bypass the budget by calling /tasks directly.
type Guard struct {
	Repo    *repository.Repository
	Billing *billing.Client
}

func New(repo *repository.Repository, client *billing.Client) Guard {
	return Guard{Repo: repo, Billing: client}
}

func (g Guard) Check(userID string, task *model.Task) error {
	if g.Repo == nil || g.Billing == nil || !g.Billing.Enabled() || task == nil || task.ProjectID == "" {
		return nil
	}
	project, err := g.Repo.ProjectForUser(userID, task.ProjectID)
	if err != nil || project.BatchID == "" {
		return nil
	}
	batch, err := g.Repo.SmartFilmBatchForUser(userID, project.BatchID)
	if err != nil {
		return err
	}
	if batch.BudgetPoints <= 0 {
		return nil
	}
	committed, err := g.Repo.SmartFilmBatchCommittedPoints(userID, batch.ID)
	if err != nil {
		return err
	}
	quote, err := g.Billing.Quote(context.Background(), userID, billingSnapshot(task))
	if err != nil || quote == nil || !quote.Enabled {
		return err
	}
	if committed+quote.Points > batch.BudgetPoints {
		return kernel.NewAppError(402, fmt.Sprintf("批次预算不足：预算 %d 积分，已占用 %d，本次预计 %d", batch.BudgetPoints, committed, quote.Points))
	}
	return nil
}

func billingSnapshot(task *model.Task) *billing.TaskSnapshot {
	if task == nil {
		return nil
	}
	clientOperationID := ""
	if task.ClientOperationID != nil {
		clientOperationID = *task.ClientOperationID
	}
	return &billing.TaskSnapshot{
		ID: task.ID, ProjectID: task.ProjectID, RouteRun: task.RouteRun, Type: task.Type,
		Operation: task.Operation, Provider: task.Provider, Model: task.Model, InputJSON: task.InputJSON,
		ClientOperationID: clientOperationID, BillingHoldID: task.BillingHoldID,
	}
}
