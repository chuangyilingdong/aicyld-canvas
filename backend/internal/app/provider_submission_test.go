package app

import (
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestCreateDirectTaskAttemptAllowsExplicitUnsentAcrossRouteRun(t *testing.T) {
	s, db := newChannelModelTestService(t)
	task := model.Task{ID: "task-direct-unsent", UserID: "user", Type: "canvas_video", Status: model.TaskStatusQueued, RouteRun: 1, Attempts: 2}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	prior := model.RouteAttempt{ID: "ATTEMPT_PRIOR", TaskID: task.ID, RouteRun: 0, AttemptNumber: 1, Status: "failed", DispatchState: "rejected_no_job", FailureCode: "request_not_sent", StartedAt: time.Now().Add(-time.Minute)}
	if err := db.Create(&prior).Error; err != nil {
		t.Fatal(err)
	}

	attempt, err := s.createDirectTaskAttempt(&task)
	if err != nil {
		t.Fatal(err)
	}
	if attempt.RouteRun != 1 || attempt.AttemptNumber != 1 || attempt.DispatchState != "not_sent" {
		t.Fatalf("new direct attempt = %+v", attempt)
	}
}

func TestCreateDirectTaskAttemptStillBlocksUncertainReceipt(t *testing.T) {
	s, db := newChannelModelTestService(t)
	task := model.Task{ID: "task-direct-unknown", UserID: "user", Type: "canvas_video", Status: model.TaskStatusQueued, RouteRun: 1, Attempts: 2}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	prior := model.RouteAttempt{ID: "ATTEMPT_UNKNOWN", TaskID: task.ID, RouteRun: 0, AttemptNumber: 1, Status: "dispatching", DispatchState: "submission_unknown", StartedAt: time.Now().Add(-time.Minute)}
	if err := db.Create(&prior).Error; err != nil {
		t.Fatal(err)
	}

	_, err := s.createDirectTaskAttempt(&task)
	if err == nil || !strings.Contains(err.Error(), "缺少提交记录") {
		t.Fatalf("uncertain prior attempt must stay fenced, err=%v", err)
	}
}
