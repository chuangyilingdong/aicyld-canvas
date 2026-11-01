package app

import (
	"context"
	"strings"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/mediaattempt"
	"infinite-canvas/backend/internal/model"
)

type providerSubmissionKeyContext = mediaattempt.SubmissionKeyContext

func uncertainVideoSubmission(ctx context.Context, err error) error {
	return generation.UncertainVideoSubmission(ctx, err)
}
func withProviderSubmissionKey(ctx context.Context, attempt *model.RouteAttempt) context.Context {
	return mediaattempt.WithAttempt(ctx, attempt)
}

func (s *Service) createDirectTaskAttempt(task *model.Task) (*model.RouteAttempt, error) {
	attemptNumber := 1
	latest, latestErr := s.repo.LatestRouteAttempt(task.ID)
	if task.Attempts > 1 && task.ProviderRequestID == "" {
		// A client retry increments route_run but keeps the same task ID. The
		// latest attempt may therefore belong to an older run; only a proven
		// no-job receipt authorizes a fresh direct submission.
		if latestErr != nil || !directAttemptSafeToResubmit(latest) {
			return nil, routeDispatchUncertainError{"旧任务已尝试执行但缺少提交记录，为避免重复创建上游任务已停止自动重发"}
		}
	}
	if latestErr == nil && latest != nil && latest.RouteRun == task.RouteRun {
		attemptNumber = latest.AttemptNumber + 1
	}
	id, err := s.repo.NextPrefixedID("ATTEMPT")
	if err != nil {
		return nil, err
	}
	attempt := &model.RouteAttempt{ID: id, TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: attemptNumber, ChannelModelID: task.ChannelModelID, Status: "selected", DispatchState: "not_sent", StartedAt: time.Now()}
	if task.ProviderRequestID != "" {
		attempt.ProviderRequestID, attempt.DispatchState = task.ProviderRequestID, "accepted"
	}
	if err := s.repo.CreateRouteAttempt(attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}

// directAttemptSafeToResubmit accepts only evidence that the provider did not
// create a job. A generic timeout, redirect failure, or missing receipt remains
// uncertain and must not create another paid submission.
func directAttemptSafeToResubmit(attempt *model.RouteAttempt) bool {
	if attempt == nil || strings.TrimSpace(attempt.ProviderRequestID) != "" {
		return false
	}
	if attempt.DispatchState == "not_sent" {
		return true
	}
	return attempt.DispatchState == "rejected_no_job" && attempt.FailureCode == "request_not_sent"
}
