package generation

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"infinite-canvas/backend/internal/platform"
)

type SubmissionUnknownError struct{ Cause error }

// RequestNotSentError is created only from transport evidence: no HTTP
// connection was acquired during this request, including any redirects.
type RequestNotSentError struct{ Cause error }

func (e RequestNotSentError) Error() string { return e.Cause.Error() }
func (e RequestNotSentError) Unwrap() error { return e.Cause }

// RequestPreparationError proves that the create request was not dispatched.
// Reference downloads may fail after their own HTTP calls, before a paid POST.
type RequestPreparationError struct{ Cause error }

func (e RequestPreparationError) Error() string {
	return fmt.Sprintf("本次请求准备失败：%v", e.Cause)
}
func (e RequestPreparationError) Unwrap() error { return e.Cause }

func (e SubmissionUnknownError) Error() string {
	return fmt.Sprintf("提交结果尚未确认：%v", e.Cause)
}

func (e SubmissionUnknownError) Unwrap() error { return e.Cause }

func SafeRouteRejection(err error) bool {
	if err == nil {
		return false
	}
	var unknown SubmissionUnknownError
	if errors.As(err, &unknown) {
		return false
	}
	if code, _ := platform.ChannelSlotFailureDetails(err); code != "" {
		return true
	}
	var upstream HTTPError
	if errors.As(err, &upstream) {
		// A structured missing-model response rejects routing before a task is
		// created, even when the gateway reports it as HTTP 503. Generic 5xx
		// responses and transport failures still cannot prove non-submission.
		fields := extractProviderFields(upstream.Body)
		if _, echoed := persistedReferencePreparationFailure(upstream.Body); echoed {
			return false
		}
		if _, echoed := persistedReferencePreparationFailure(fields.Message); echoed {
			return false
		}
		if upstream.StatusCode >= 400 && fields.Code == "model_not_found" && fields.TaskID == "" {
			return true
		}
		switch upstream.StatusCode {
		// 参数校验类 4xx 是上游明确拒绝（没有创建任务），重试安全，不能当成「提交结果未知」。
		case http.StatusBadRequest, http.StatusUnauthorized, http.StatusPaymentRequired, http.StatusForbidden,
			http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusRequestEntityTooLarge,
			http.StatusUnprocessableEntity, http.StatusTooManyRequests:
			return true
		}
	}
	return false
}

func UncertainVideoSubmission(ctx context.Context, err error) error {
	var notSent RequestNotSentError
	var unknown SubmissionUnknownError
	if errors.As(err, &notSent) || errors.As(err, &unknown) {
		return err
	}
	var preparation RequestPreparationError
	if errors.As(err, &preparation) {
		return err
	}
	if err == nil || errors.Is(err, context.Canceled) || SafeRouteRejection(err) {
		return err
	}
	var circuit CircuitOpenError
	if errors.As(err, &circuit) {
		return err
	}
	if retry, _ := RetryableVideoPollError(context.Background(), err); retry {
		return SubmissionUnknownError{Cause: err}
	}
	// Once the create request has been attempted, only typed/safe route
	// rejections above can prove that no upstream task was created.
	return SubmissionUnknownError{Cause: err}
}
