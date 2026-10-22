package app

import (
	"context"
	"net/http"
	"testing"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/modelcatalog"
)

func TestUnknownRouteFailureDoesNotRecoverNestedRejectionEvidence(t *testing.T) {
	cases := []struct {
		name  string
		cause error
	}{
		{name: "preparation", cause: generation.RequestPreparationError{Cause: providerHTTPError{StatusCode: http.StatusServiceUnavailable, Body: `{"error":{"code":"image_reference_upload_failed"}}`}}},
		{name: "forbidden", cause: providerHTTPError{StatusCode: http.StatusForbidden}},
		{name: "throttled", cause: providerHTTPError{StatusCode: http.StatusTooManyRequests, RetryAfter: time.Minute}},
		{name: "not-sent", cause: generation.RequestNotSentError{Cause: context.DeadlineExceeded}},
		{name: "cancelled", cause: context.Canceled},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			err := generation.SubmissionUnknownError{Cause: test.cause}
			if info := routeFailureInfo(err); info != (modelcatalog.FailureInfo{}) {
				t.Fatalf("unknown wrapper leaked nested route evidence: %+v", info)
			}
			if safeRouteRejection(err) {
				t.Fatal("unknown submission was allowed to switch routes")
			}
			if code := routeFailureCode(err); code != "submission_unknown" {
				t.Fatalf("routeFailureCode() = %q, want submission_unknown", code)
			}
		})
	}
}

func TestImageRecoveryKeepsNestedNotSentEvidenceUncertain(t *testing.T) {
	info := routeFailureInfo(imageRecoveryError{cause: generation.RequestNotSentError{Cause: context.DeadlineExceeded}})
	if !info.ImageRecovery || info.RequestNotSent || safeRouteRejection(imageRecoveryError{cause: generation.RequestNotSentError{Cause: context.DeadlineExceeded}}) {
		t.Fatalf("image recovery leaked retry-safe evidence: %+v", info)
	}
}
