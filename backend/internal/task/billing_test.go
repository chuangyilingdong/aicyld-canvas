package task

import (
	"context"
	"sync"
	"testing"

	billingclient "infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
)

type fakeTaskBilling struct {
	mu        sync.Mutex
	reserves  int
	releases  int
	settles   int
	quotes    int
	reserveID string
}

func (b *fakeTaskBilling) Enabled() bool { return true }

func (b *fakeTaskBilling) Quote(context.Context, string, *model.Task) (*billingclient.BillingQuote, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.quotes++
	return &billingclient.BillingQuote{Enabled: true, Points: 7, Balance: 20}, nil
}

func (b *fakeTaskBilling) Reserve(context.Context, string, *model.Task) (*billingclient.BillingReservation, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.reserves++
	if b.reserveID == "" {
		b.reserveID = "hold-1"
	}
	return &billingclient.BillingReservation{Enabled: true, HoldID: b.reserveID, Points: 7, Balance: 20, Status: "reserved"}, nil
}

func (b *fakeTaskBilling) Settle(context.Context, *model.Task, string, string) (*billingclient.BillingSettlement, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.settles++
	return &billingclient.BillingSettlement{Status: "settled", ChargedPoints: 7}, nil
}

func (b *fakeTaskBilling) Release(context.Context, *model.Task, string) (*billingclient.BillingSettlement, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.releases++
	return &billingclient.BillingSettlement{Status: "refunded"}, nil
}

func TestQuoteTaskDoesNotPersistOrReserve(t *testing.T) {
	store := newMemStore()
	billing := &fakeTaskBilling{}
	service := domainService(store, func(deps *Dependencies) { deps.Billing = billing })
	quote, err := service.QuoteTask("user", CreateRequest{Type: "canvas_image", Prompt: "cat", Input: map[string]any{"prompt": "cat"}})
	if err != nil {
		t.Fatal(err)
	}
	if quote == nil || quote.Points != 7 {
		t.Fatalf("quote = %+v", quote)
	}
	if billing.quotes != 1 || billing.reserves != 0 {
		t.Fatalf("billing calls quotes=%d reserves=%d", billing.quotes, billing.reserves)
	}
	if len(store.tasks) != 0 {
		t.Fatalf("quote persisted task: %+v", store.tasks)
	}
}

func TestCreateTaskReservesAndStoresBillingMetadata(t *testing.T) {
	store := newMemStore()
	billing := &fakeTaskBilling{}
	service := domainService(store, func(deps *Dependencies) { deps.Billing = billing })
	created, err := service.CreateTask("user", CreateRequest{Type: "canvas_image", Prompt: "cat", Input: map[string]any{"prompt": "cat"}})
	if err != nil {
		t.Fatal(err)
	}
	if billing.reserves != 1 || created.BillingHoldID != "hold-1" || created.BillingStatus != "reserved" || created.BillingPoints != 7 {
		t.Fatalf("created billing = %+v reserves=%d", created, billing.reserves)
	}
	saved := store.tasks[created.ID]
	if saved.BillingHoldID != "hold-1" || saved.BillingStatus != "reserved" || saved.BillingPoints != 7 {
		t.Fatalf("stored billing = %+v", saved)
	}
}

func TestDuplicateAdmissionDoesNotReserveTwice(t *testing.T) {
	store := newMemStore()
	billing := &fakeTaskBilling{}
	service := domainService(store, func(deps *Dependencies) { deps.Billing = billing })
	request := CreateRequest{Type: "canvas_image", Prompt: "cat", Input: map[string]any{
		"prompt": "cat", "metadata": map[string]any{"clientOperationId": "proposal:gp-1:node-1"},
	}}
	first, err := service.CreateTask("user", request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreateTask("user", request)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || billing.reserves != 1 {
		t.Fatalf("first=%s second=%s reserves=%d", first.ID, second.ID, billing.reserves)
	}
}

func TestCancelTaskReleasesReservedBilling(t *testing.T) {
	store := newMemStore()
	billing := &fakeTaskBilling{}
	service := domainService(store, func(deps *Dependencies) { deps.Billing = billing })
	created, err := service.CreateTask("user", CreateRequest{Type: "canvas_image", Prompt: "cat", Input: map[string]any{"prompt": "cat"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Cancel(context.Background(), "user", created.ID); err != nil {
		t.Fatal(err)
	}
	if billing.releases != 1 {
		t.Fatalf("releases = %d", billing.releases)
	}
}

func TestRetryReservesNewBillingAttempt(t *testing.T) {
	store := newMemStore()
	billing := &fakeTaskBilling{}
	service := domainService(store, func(deps *Dependencies) { deps.Billing = billing })
	created, err := service.CreateTask("user", CreateRequest{Type: "canvas_image", Prompt: "cat", Input: map[string]any{"prompt": "cat"}})
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	failed := store.tasks[created.ID]
	failed.Status = model.TaskStatusFailed
	failed.Error = "failed"
	store.tasks[created.ID] = failed
	store.mu.Unlock()
	billing.mu.Lock()
	billing.reserveID = "hold-2"
	billing.mu.Unlock()
	retried, err := service.Retry("user", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if billing.reserves != 2 || retried.BillingHoldID != "hold-2" || retried.RouteRun != 1 {
		t.Fatalf("retried=%+v reserves=%d", retried, billing.reserves)
	}
}
