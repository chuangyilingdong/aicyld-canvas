package app

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
)

type providerSubmissionKeyContext struct{}

func uncertainVideoSubmission(ctx context.Context, err error) error {
	return generation.UncertainVideoSubmission(ctx, err)
}

func withProviderSubmissionKey(ctx context.Context, attempt *model.RouteAttempt) context.Context {
	if attempt == nil {
		return ctx
	}
	// Stable for this persisted attempt across worker/process recovery; an
	// explicitly new user retry or a safely rejected route gets a new attempt.
	key := uuid.NewSHA1(uuid.NameSpaceOID, []byte(attempt.TaskID+":"+attempt.ID)).String()
	ctx = context.WithValue(ctx, imageAttemptContext{}, attempt.ID)
	ctx = context.WithValue(ctx, providerSubmissionKeyContext{}, key)
	return generation.WithSubmissionKey(ctx, key)
}

func (s *Service) createDirectTaskAttempt(task *model.Task) (*model.RouteAttempt, error) {
	attemptNumber := 1
	latest, latestErr := s.repo.LatestRouteAttempt(task.ID)
	if task.Attempts > 1 && task.ProviderRequestID == "" {
		// Worker claims may be retried after a client-side RetryTask. In that case
		// the previous route attempt belongs to an older route_run, so a current-run
		// lookup alone is not enough to prove whether an upstream request was sent.
		// Only an explicit no-job receipt authorizes a new direct attempt.
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

func directAttemptSafeToResubmit(attempt *model.RouteAttempt) bool {
	if attempt == nil || strings.TrimSpace(attempt.ProviderRequestID) != "" {
		return false
	}
	if attempt.DispatchState == "not_sent" {
		return true
	}
	return attempt.DispatchState == "rejected_no_job" && attempt.FailureCode == "request_not_sent"
}
