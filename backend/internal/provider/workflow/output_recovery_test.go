package workflow

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"testing"
)

func TestRunningHubOutputIdentityKeepsDistinctFieldsAndURLs(t *testing.T) {
	var body map[string]any
	if err := json.Unmarshal([]byte(`{"images":[{"fileUrl":"https://media.example/image.png"}],"videos":[{"outputId":"movie","fileUrl":"https://media.example/a.mp4","downloadUrl":"https://media.example/b.mp4","url":"https://media.example/a.mp4"}]}`), &body); err != nil {
		t.Fatal(err)
	}
	want := []string{"https://media.example/image.png", "https://media.example/b.mp4", "https://media.example/a.mp4"}
	for i := 0; i < 50; i++ {
		if got := OutputURLs(body); !reflect.DeepEqual(got, want) {
			t.Fatalf("output ordering/dedup changed: %v", got)
		}
	}
	outputs := runningHubOutputs(body)
	if outputs[1].ID != "movie" || outputs[2].ID != "movie" || outputs[1].Field != "/downloadurl" || outputs[2].Field != "/fileurl" || outputs[1].Owner != "/videos/0" {
		t.Fatalf("output identity lost: %#v", outputs)
	}
}

func TestRunningHubOutputRenewalMatchesIDAfterReorder(t *testing.T) {
	original := runningHubOutput{URL: "https://media.example/old-a.mp4", ID: "a", Field: "/fileurl", Owner: "/videos/0"}
	fresh := []runningHubOutput{
		{URL: "https://media.example/new-b.mp4", ID: "b", Field: "/fileurl", Owner: "/videos/0"},
		{URL: "https://media.example/new-a.mp4", ID: "a", Field: "/fileurl", Owner: "/videos/1"},
	}
	matched, err := matchRunningHubOutput(original, fresh)
	if err != nil || matched.URL != "https://media.example/new-a.mp4" {
		t.Fatalf("matched=%#v err=%v", matched, err)
	}
}

func TestRunningHubLegacyRenewalMatchesPathAndRejectsAmbiguity(t *testing.T) {
	original := runningHubOutput{URL: "https://media.example/assets/a.mp4?signature=old", Field: "/videos/0/fileurl"}
	unique, err := matchRunningHubOutput(original, []runningHubOutput{{URL: "https://media.example/assets/a.mp4?signature=new", Field: "/videos/0/fileurl"}})
	if err != nil || unique.URL != "https://media.example/assets/a.mp4?signature=new" {
		t.Fatalf("unique=%#v err=%v", unique, err)
	}
	if _, err := matchRunningHubOutput(original, []runningHubOutput{
		{URL: "https://media.example/assets/a.mp4?signature=new1", Field: "/videos/0/fileurl"},
		{URL: "https://media.example/assets/a.mp4?signature=new2", Field: "/videos/1/fileurl"},
	}); err == nil {
		t.Fatal("ambiguous legacy output was accepted")
	}
}

func TestRunningHubQueryRejectsOtherTaskIDAndEmptyURLs(t *testing.T) {
	for _, body := range []string{
		`{"taskId":"other","data":{"fileUrl":"https://media.example/a.mp4"}}`,
		`{"data":{"taskId":"other","outputs":[{"fileUrl":"https://media.example/a.mp4"}]}}`,
	} {
		var response map[string]any
		if err := json.Unmarshal([]byte(body), &response); err != nil {
			t.Fatal(err)
		}
		if err := validateRunningHubQueryTaskID(response, "original"); err == nil {
			t.Fatalf("accepted foreign task: %s", body)
		}
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(`{"outputs":[{"fileUrl":""},{"fileUrl":null}]}`), &body); err != nil {
		t.Fatal(err)
	}
	if outputs := runningHubOutputs(body); len(outputs) != 0 {
		t.Fatalf("empty URLs became outputs: %#v", outputs)
	}
}

type retryingDownloadPoller struct{ immediatePoller }

func (retryingDownloadPoller) Download(ctx context.Context, _ string, _ PollPolicy, download func(context.Context) ([]byte, string, error)) ([]byte, string, error) {
	if _, _, err := download(ctx); err == nil {
		return nil, "", errors.New("fixture unexpectedly downloaded before renewal")
	}
	return download(ctx)
}

func TestRunningHubPollRenewsOriginalOutputByID(t *testing.T) {
	queries, oldReads, newReads := 0, 0, 0
	exec := &scriptedExecutor{handler: func(req Request) ([]byte, string, error) {
		switch req.Method {
		case http.MethodPost:
			queries++
			outputs := []any{
				map[string]any{"outputId": "a", "fileUrl": "https://media.example/old-a.mp4"},
				map[string]any{"outputId": "b", "fileUrl": "https://media.example/old-b.mp4"},
			}
			if queries > 1 {
				outputs = []any{
					map[string]any{"outputId": "b", "fileUrl": "https://media.example/new-b.mp4"},
					map[string]any{"outputId": "a", "fileUrl": "https://media.example/new-a.mp4"},
				}
			}
			data, _ := json.Marshal(map[string]any{"taskId": "original", "data": map[string]any{"outputs": outputs}})
			return data, "application/json", nil
		case http.MethodGet:
			switch req.URL {
			case "https://media.example/old-a.mp4":
				oldReads++
				return nil, "", StatusError{StatusCode: http.StatusServiceUnavailable, Body: `{"error":{"code":"video_delivery_pending"}}`}
			case "https://media.example/new-a.mp4":
				newReads++
				return []byte("\x00\x00\x00\x18ftypmp42fixture"), "video/mp4", nil
			}
		}
		return nil, "", errors.New("unexpected provider request")
	}}
	client := &Client{Requests: exec, Poller: retryingDownloadPoller{}}
	result, err := client.PollVideo(context.Background(), Config{BaseURL: "https://workflow.example", APIKey: "fixture"}, "https://workflow.example", "original", defaultVideoPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if queries != 2 || oldReads != 1 || newReads != 1 {
		t.Fatalf("queries=%d old=%d new=%d", queries, oldReads, newReads)
	}
	if result["mode"] != "video" || result["video"] == nil {
		t.Fatalf("video result missing: %#v", result)
	}
}
