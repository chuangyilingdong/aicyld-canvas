package app

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCanvasOnboardingFunnelDeduplicatesAndRequiresAdmin(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:canvas-onboarding-funnel?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasOnboardingEvent{}); err != nil {
		t.Fatal(err)
	}
	service := NewLocal(repository.New(db), t.TempDir())
	for _, item := range []struct {
		userID   string
		event    string
		canvasID string
	}{
		{"user-1", "canvas_created", "canvas-1"},
		{"user-1", "canvas_created", "canvas-1"},
		{"user-1", "canvas_opened", "canvas-1"},
		{"user-2", "canvas_created", "canvas-2"},
		{"user-2", "image_requested", "canvas-2"},
	} {
		if err := service.RecordCanvasOnboardingEvent(item.userID, item.event, item.canvasID, ""); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	rows, err := service.CanvasOnboardingFunnel(&model.User{ID: "admin", Role: model.UserRoleAdmin}, now.Add(-time.Hour), now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]struct{ count, users int64 }{}
	for _, row := range rows {
		counts[row.Event] = struct{ count, users int64 }{row.Count, row.Users}
	}
	if counts["canvas_created"].count != 2 || counts["canvas_created"].users != 2 {
		t.Fatalf("canvas_created = %+v", counts["canvas_created"])
	}
	if counts["canvas_opened"].count != 1 || counts["image_requested"].count != 1 {
		t.Fatalf("unexpected funnel rows = %+v", counts)
	}
	if _, err := service.CanvasOnboardingFunnel(&model.User{ID: "user-1", Role: model.UserRoleUser}, now.Add(-time.Hour), now.Add(time.Hour)); err == nil {
		t.Fatal("non-admin read the global funnel")
	}
}