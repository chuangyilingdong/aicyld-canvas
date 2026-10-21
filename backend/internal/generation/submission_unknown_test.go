package generation

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestUnknownSubmissionDominatesNestedFailureEvidence(t *testing.T) {
	cases := []struct {
		name  string
		cause error
	}{
		{name: "preparation", cause: RequestPreparationError{Cause: HTTPError{StatusCode: http.StatusServiceUnavailable, Body: `{"error":{"code":"image_reference_upload_failed"}}`}}},
		{name: "not-sent", cause: RequestNotSentError{Cause: context.DeadlineExceeded}},
		{name: "cancelled", cause: context.Canceled},
		{name: "forbidden", cause: HTTPError{StatusCode: http.StatusForbidden}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			err := SubmissionUnknownError{Cause: test.cause}
			failure := ClassifyError(err)
			if failure.Category != CategorySubmissionUncertain || !failure.Uncertain || failure.Retryable {
				t.Fatalf("unknown submission lost precedence: %+v", failure)
			}
			if !failure.BlocksAutomaticRetry() {
				t.Fatal("unknown submission must block automatic retry")
			}
			if SafeRouteRejection(err) {
				t.Fatal("unknown submission must not be treated as a safe route rejection")
			}
		})
	}
}

func TestDirectUnsentAndPreparationEvidenceRemainRetrySafe(t *testing.T) {
	if failure := ClassifyError(RequestNotSentError{Cause: errors.New("dial failed")}); failure.Category != CategoryRequestNotSent || failure.Uncertain {
		t.Fatalf("direct unsent request classified incorrectly: %+v", failure)
	}
	preparation := RequestPreparationError{Cause: errors.New("reference download failed")}
	if failure := ClassifyError(preparation); failure.Category != CategoryInputInaccessible || failure.Uncertain {
		t.Fatalf("direct preparation failure classified incorrectly: %+v", failure)
	}
}
