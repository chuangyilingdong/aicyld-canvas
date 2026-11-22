package generation

import "testing"

func TestRunningHubBusinessFailureUsesErrorCodeFields(t *testing.T) {
	body := []byte(`{
		"errorCode":"1007",
		"errorMessage":"field 'resolution' value 720 is not in the allowed options, allowed values: 1k, 2k, 4k",
		"taskId":"",
		"status":""
	}`)
	code, message, failed := ResponseBusinessFailure(body)
	if !failed || code != "1007" || message != "field 'resolution' value 720 is not in the allowed options, allowed values: 1k, 2k, 4k" {
		t.Fatalf("business failure = code:%q message:%q failed:%v", code, message, failed)
	}
}

func TestRunningHubExplicitCreateFailureIsNotSubmissionUncertain(t *testing.T) {
	err := &ProtocolTaskError{Message: "RunningHub 提交失败（1007）：field 'resolution' is invalid"}
	info := RouteFailureInfo(err)
	if !info.ExplicitRejection || info.TerminalProviderFailure {
		t.Fatalf("failure info = %#v", info)
	}
	if got := RouteFailureCode(err); got != "upstream_failed" {
		t.Fatalf("route failure code = %q", got)
	}
	if !SafeCatalogRouteRejection(err) {
		t.Fatal("explicit provider rejection must create a retryable failure without an upstream job")
	}
	if failure := ClassifyTaskFailure(err); failure.Category != CategoryInvalidParams || failure.Uncertain {
		t.Fatalf("task failure = %#v", failure)
	}
}

func TestRunningHubAcceptedTaskFailureRemainsTerminal(t *testing.T) {
	err := &ProtocolTaskError{TaskID: "2123730909370130434", Message: "upstream failed"}
	info := RouteFailureInfo(err)
	if !info.TerminalProviderFailure || info.ExplicitRejection {
		t.Fatalf("failure info = %#v", info)
	}
	if got := RouteFailureCode(err); got != "upstream_failed" {
		t.Fatalf("route failure code = %q", got)
	}
}
