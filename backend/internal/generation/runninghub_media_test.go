package generation

import (
	"context"
	"encoding/base64"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type runningHubResourceFixture struct {
	data         []byte
	lookups      atomic.Int32
	opens        atomic.Int32
	publicURLs   atomic.Int32
	provider     string
	localMode    bool
	mimeType     string
	resourceKind string
}

func (p *runningHubResourceFixture) Lookup(_, id string) (ResourceInfo, error) {
	p.lookups.Add(1)
	return ResourceInfo{
		ID:       id,
		Status:   "ready",
		Kind:     p.resourceKind,
		MimeType: p.mimeType,
		Provider: p.provider,
		Size:     int64(len(p.data)),
		Width:    1,
		Height:   1,
	}, nil
}

func (p *runningHubResourceFixture) Open(_, id string) (ResourceInfo, io.ReadCloser, error) {
	p.opens.Add(1)
	info, err := p.Lookup("", id)
	return info, io.NopCloser(strings.NewReader(string(p.data))), err
}

func (p *runningHubResourceFixture) PublicURL(ResourceInfo, time.Time) (string, error) {
	p.publicURLs.Add(1)
	return "https://cdn.example/should-not-be-used.png", nil
}

func (p *runningHubResourceFixture) HTTPSPublicURL(info ResourceInfo, expires time.Time) (string, error) {
	return p.PublicURL(info, expires)
}

func (p *runningHubResourceFixture) LocalMode() bool { return p.localMode }

func TestRunningHubLocalResourceUploadsBinaryAndCachesDownloadURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	resetRunningHubMediaURLCacheForTest()
	t.Cleanup(resetRunningHubMediaURLCacheForTest)

	png := decodeTestPNG(t)
	var uploads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != runningHubMediaUploadPath {
			http.NotFound(w, r)
			return
		}
		uploads.Add(1)
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer upload-key" {
			t.Errorf("unexpected upload request: %s %s auth=%q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
		}
		mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
			t.Errorf("content type = %q params=%v err=%v", mediaType, params, err)
		}
		reader, err := r.MultipartReader()
		if err != nil {
			t.Errorf("multipart reader: %v", err)
			http.Error(w, "bad multipart", http.StatusBadRequest)
			return
		}
		var fileData []byte
		fileSeen := false
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Errorf("next part: %v", err)
				break
			}
			if part.FormName() == "apiKey" {
				t.Error("official binary upload must not send apiKey as a form field")
			}
			if part.FormName() == "file" {
				fileSeen = true
				if !strings.HasSuffix(part.FileName(), ".png") || part.Header.Get("Content-Type") != "image/png" {
					t.Errorf("file part filename=%q type=%q", part.FileName(), part.Header.Get("Content-Type"))
				}
				fileData, _ = io.ReadAll(part)
			}
		}
		if !fileSeen || string(fileData) != string(png) {
			t.Error("upload did not contain the original resource bytes")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"code":0,"data":{"download_url":"https://download.example/reference.png","size":"`+strconv.Itoa(len(png))+`","type":"image/png"}}`)
	}))
	t.Cleanup(server.Close)

	resources := &runningHubResourceFixture{data: png, provider: "local", mimeType: "image/png", resourceKind: "image"}
	ctx := WithRuntime(context.Background(), Runtime{Resources: resources})
	input := Input{
		Mode:            "image",
		Config:          Config{InterfaceType: "runninghub-standard-image", BaseURL: server.URL, APIKey: "submit-key", RunningHubUploadKey: "upload-key"},
		ReferenceImages: []Media{{ID: "ref-1", StorageKey: "resource:ref-1", Name: "ref.png", Type: "image", MimeType: "image/png"}},
	}
	if err := ValidateMediaTransport(ctx, input); err != nil {
		t.Fatalf("preflight rejected provider-owned upload: %v", err)
	}
	if err := HydrateMedia(ctx, "owner", &input, MediaHydrationPolicyFor(ctx, input)); err != nil {
		t.Fatal(err)
	}
	if got := input.ReferenceImages[0].URL; got != "https://download.example/reference.png" {
		t.Fatalf("reference URL = %q", got)
	}
	if input.ReferenceImages[0].DataURL != "" || resources.publicURLs.Load() != 0 {
		t.Fatalf("reference kept inline data or used signed fallback: %+v publicURLs=%d", input.ReferenceImages[0], resources.publicURLs.Load())
	}

	second := Input{
		Mode:            "image",
		Config:          input.Config,
		ReferenceImages: []Media{{ID: "ref-2", StorageKey: "resource:ref-2", Name: "second.png", Type: "image", MimeType: "image/png"}},
	}
	if err := HydrateMedia(ctx, "owner", &second, MediaHydrationPolicyFor(ctx, second)); err != nil {
		t.Fatal(err)
	}
	if uploads.Load() != 1 || resources.opens.Load() != 2 {
		t.Fatalf("uploads=%d opens=%d, want one upload and two resource reads", uploads.Load(), resources.opens.Load())
	}
	if runningHubMediaCacheTTL >= 24*time.Hour {
		t.Fatalf("cache TTL must stay below the one-day RunningHub URL lifetime: %s", runningHubMediaCacheTTL)
	}
}

func TestRunningHubUploadFailureIsPreSubmissionAndNeverFallsBackToSignedURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	resetRunningHubMediaURLCacheForTest()
	t.Cleanup(resetRunningHubMediaURLCacheForTest)

	png := decodeTestPNG(t)
	var uploads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uploads.Add(1)
		http.Error(w, "invalid upload key", http.StatusUnauthorized)
	}))
	t.Cleanup(server.Close)

	resources := &runningHubResourceFixture{data: png, provider: "local", mimeType: "image/png", resourceKind: "image"}
	ctx := WithRuntime(context.Background(), Runtime{Resources: resources})
	input := Input{
		Mode:            "image",
		Config:          Config{InterfaceType: "runninghub-standard-image", BaseURL: server.URL, APIKey: "bad-key"},
		ReferenceImages: []Media{{ID: "ref-1", StorageKey: "resource:ref-1", Type: "image", MimeType: "image/png"}},
	}
	err := HydrateMedia(ctx, "owner", &input, MediaHydrationPolicyFor(ctx, input))
	if err == nil {
		t.Fatal("expected upload failure")
	}
	failure := ClassifyError(err)
	if failure.ProviderCode != "runninghub_reference_upload_failed" || failure.Category != CategoryProviderUnavailable || failure.Uncertain || failure.Retryable {
		t.Fatalf("failure = %+v", failure)
	}
	if !failure.BlocksAutomaticRetry() || failure.BlocksManualRetry() {
		t.Fatalf("retry policy = %+v", failure)
	}
	if uploads.Load() != 1 || resources.publicURLs.Load() != 0 || input.ReferenceImages[0].URL != "" {
		t.Fatalf("uploads=%d publicURLs=%d media=%+v", uploads.Load(), resources.publicURLs.Load(), input.ReferenceImages[0])
	}
	if message := failure.UserMessage(); !strings.Contains(message, "本次尚未开始生成") || strings.Contains(message, "invalid upload key") {
		t.Fatalf("unsafe or misleading failure copy: %q", message)
	}
}

func decodeTestPNG(t *testing.T) []byte {
	t.Helper()
	const onePixelPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
	data, err := base64.StdEncoding.DecodeString(onePixelPNG)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
