package playback

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestPosterGeneratesCachesAndClearsOwnedVideo(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "resources", "video.mp4")
	if err := os.MkdirAll(filepath.Dir(source), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("video-source"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := &cacheTestStore{}
	store.put(model.Resource{
		ID: "video", UserID: "owner", Kind: "video", Provider: "local",
		Status: model.ResourceStatusReady, ObjectKey: "video.mp4", ETag: "v1",
	})
	calls := 0
	service := New(Deps{
		DataDir: root,
		Store:   store,
		RenderPoster: func(_ context.Context, _, destination string, width int) error {
			calls++
			if width != 320 {
				t.Fatalf("poster width = %d, want 320", width)
			}
			return os.WriteFile(destination, []byte("jpeg"), 0o644)
		},
	})

	first, err := service.Poster("owner", "video", 320)
	if err != nil || string(first) != "jpeg" {
		t.Fatalf("poster = %q, %v", first, err)
	}
	second, err := service.Poster("owner", "video", 320)
	if err != nil || string(second) != "jpeg" {
		t.Fatalf("cached poster = %q, %v", second, err)
	}
	if calls != 1 {
		t.Fatalf("render calls = %d, want 1", calls)
	}
	if _, err := service.Poster("other", "video", 320); !errors.Is(err, ErrPosterUnavailable) {
		t.Fatalf("foreign poster error = %v", err)
	}
	if cleared, err := service.ClearCache("owner"); err != nil || cleared != 1 {
		t.Fatalf("clear cache = %d, %v", cleared, err)
	}
	if _, err := service.Poster("owner", "video", 320); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("render calls after clear = %d, want 2", calls)
	}
}

func TestPosterRejectsMissingSourceAndNonVideo(t *testing.T) {
	root := t.TempDir()
	store := &cacheTestStore{}
	store.put(model.Resource{
		ID: "missing", UserID: "owner", Kind: "video", Provider: "local",
		Status: model.ResourceStatusReady, ObjectKey: "missing.mp4",
	})
	store.put(model.Resource{
		ID: "image", UserID: "owner", Kind: "image", Provider: "local",
		Status: model.ResourceStatusReady, ObjectKey: "image.png",
	})
	service := New(Deps{DataDir: root, Store: store})
	for _, id := range []string{"missing", "image"} {
		if _, err := service.Poster("owner", id, 480); !errors.Is(err, ErrPosterUnavailable) {
			t.Fatalf("%s poster error = %v", id, err)
		}
	}
}
