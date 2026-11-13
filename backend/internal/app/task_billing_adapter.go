package app

import (
	"context"

	billingclient "infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

type taskBillingAdapter struct{ client *billingclient.Client }

func (a taskBillingAdapter) Enabled() bool {
	return a.client != nil && a.client.Enabled()
}

func (a taskBillingAdapter) Quote(ctx context.Context, userID string, task *model.Task) (*billingclient.BillingQuote, error) {
	if a.client == nil || !a.client.Enabled() {
		return &billingclient.BillingQuote{Enabled: false}, nil
	}
	quote, err := a.client.Quote(ctx, userID, billingTaskSnapshot(task))
	if err != nil {
		if billingclient.IsRuleMissing(err) {
			return nil, kernel.BadAuthRequest(err.Error())
		}
		return nil, err
	}
	return quote, nil
}

func (a taskBillingAdapter) Reserve(ctx context.Context, userID string, task *model.Task) (*billingclient.BillingReservation, error) {
	if a.client == nil || !a.client.Enabled() {
		return &billingclient.BillingReservation{Enabled: false, Status: "free"}, nil
	}
	reservation, err := a.client.Reserve(ctx, userID, billingTaskSnapshot(task))
	if err != nil {
		if billingclient.IsInsufficient(err) {
			return nil, kernel.NewAppError(402, err.Error())
		}
		if billingclient.IsRuleMissing(err) {
			return nil, kernel.BadAuthRequest(err.Error())
		}
		return nil, err
	}
	return reservation, nil
}

func (a taskBillingAdapter) Settle(ctx context.Context, task *model.Task, outcome string, reason string) (*billingclient.BillingSettlement, error) {
	if a.client == nil || !a.client.Enabled() {
		return &billingclient.BillingSettlement{Status: "free"}, nil
	}
	return a.client.Settle(ctx, billingTaskSnapshot(task), outcome, reason)
}

func (a taskBillingAdapter) Release(ctx context.Context, task *model.Task, reason string) (*billingclient.BillingSettlement, error) {
	if a.client == nil || !a.client.Enabled() {
		return &billingclient.BillingSettlement{Status: "free"}, nil
	}
	return a.client.Release(ctx, billingTaskSnapshot(task), reason)
}

func taskClientOperationID(task *model.Task) string {
	if task == nil || task.ClientOperationID == nil {
		return ""
	}
	return *task.ClientOperationID
}

func billingTaskSnapshot(task *model.Task) *billingclient.TaskSnapshot {
	if task == nil {
		return nil
	}
	return &billingclient.TaskSnapshot{
		ID:                task.ID,
		ProjectID:         task.ProjectID,
		RouteRun:          task.RouteRun,
		Type:              task.Type,
		Operation:         task.Operation,
		Provider:          task.Provider,
		Model:             task.Model,
		InputJSON:         task.InputJSON,
		ClientOperationID: taskClientOperationID(task),
		BillingHoldID:     task.BillingHoldID,
	}
}
