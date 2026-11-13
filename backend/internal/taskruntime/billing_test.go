package taskruntime

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	billingclient "infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
)

type terminalBillingRepoStub struct {
	mu     sync.Mutex
	task   model.Task
	status string
	hold   string
	points int
}

func (r *terminalBillingRepoStub) Task(string) (*model.Task, error) {
	copied := r.task
	return &copied, nil
}

func (r *terminalBillingRepoStub) UpdateTaskTerminalState(string, string, model.TaskStatus, model.TaskStatus, string, string, time.Time, ...*model.TaskFailureDiagnostics) (bool, error) {
	return true, nil
}

func (r *terminalBillingRepoStub) UpdateTaskBilling(userID, taskID, holdID, status string, points int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.status = status
	r.hold = holdID
	r.points = points
	return nil
}

type terminalBillingStub struct {
	mu        sync.Mutex
	settles   int
	releases  int
	settleErr error
}

func (b *terminalBillingStub) Settle(context.Context, *model.Task, string, string) (*billingclient.BillingSettlement, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.settles++
	if b.settleErr != nil {
		return nil, b.settleErr
	}
	return &billingclient.BillingSettlement{Status: "settled", ChargedPoints: 3}, nil
}

func (b *terminalBillingStub) Release(context.Context, *model.Task, string) (*billingclient.BillingSettlement, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.releases++
	return &billingclient.BillingSettlement{Status: "refunded"}, nil
}

type terminalLoggerStub struct{}

func (terminalLoggerStub) Log(string, string, string, string, string) error { return nil }

type terminalOutputsStub struct{}

func (terminalOutputsStub) DeliverSucceededTask(model.Task) error       { return nil }
func (terminalOutputsStub) RegisterTaskOutputFromTask(model.Task) error { return nil }

func newBillingTerminal(repo *terminalBillingRepoStub, billing *terminalBillingStub) *Terminal {
	return NewTerminal(TerminalDependencies{
		Repository:        repo,
		Replay:            terminalReplayStub{},
		Logger:            terminalLoggerStub{},
		Outputs:           terminalOutputsStub{},
		Billing:           billing,
		UserFacingMessage: func(err error) string { return err.Error() },
		CaptureFailure:    func(*model.Task, error, string) {},
	})
}

type terminalReplayStub struct{}

func (terminalReplayStub) FinalizeTaskTextReplay(string, model.TaskStatus) error { return nil }

func TestTerminalSettlesSuccessfulTask(t *testing.T) {
	repo := &terminalBillingRepoStub{task: model.Task{ID: "task-1", UserID: "user"}}
	billing := &terminalBillingStub{}
	terminal := newBillingTerminal(repo, billing)
	task := &model.Task{ID: "task-1", UserID: "user", BillingHoldID: "hold-1", BillingStatus: "reserved", BillingPoints: 3}
	if err := terminal.HandleSuccess(task); err != nil {
		t.Fatal(err)
	}
	if billing.settles != 1 || repo.status != "settled" || repo.points != 3 {
		t.Fatalf("settles=%d status=%s points=%d", billing.settles, repo.status, repo.points)
	}
}

func TestTerminalRefundsPreparationFailure(t *testing.T) {
	repo := &terminalBillingRepoStub{}
	billing := &terminalBillingStub{}
	terminal := newBillingTerminal(repo, billing)
	task := &model.Task{ID: "task-2", UserID: "user", BillingHoldID: "hold-2", BillingStatus: "reserved"}
	if err := terminal.MarkPreparationFailure(task, "准备失败", errors.New("prepare failed"), false, ""); err == nil {
		t.Fatal("preparation failure returned nil")
	}
	if billing.releases != 1 || repo.status != "refunded" {
		t.Fatalf("releases=%d status=%s", billing.releases, repo.status)
	}
}

func TestTerminalKeepsUnknownSubmissionForReconcile(t *testing.T) {
	repo := &terminalBillingRepoStub{}
	billing := &terminalBillingStub{}
	terminal := newBillingTerminal(repo, billing)
	task := &model.Task{ID: "task-3", UserID: "user", BillingHoldID: "hold-3", BillingStatus: "reserved"}
	terminal.markBillingPending(task, "上游结果未确认")
	if billing.releases != 0 || repo.status != "pending_reconcile" {
		t.Fatalf("releases=%d status=%s", billing.releases, repo.status)
	}
}
