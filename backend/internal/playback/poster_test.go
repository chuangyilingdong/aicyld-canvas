package playback

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func TestPosterCachePrunesExpiredAndOverLimitFiles(t *testing.T) {
	root := t.TempDir()
	service := New(Deps{DataDir: root})
	cacheDir := filepath.Join(root, PosterDirName, "workspace")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	writePoster := func(name, value string, modTime time.Time) string {
		path := filepath.Join(cacheDir, name)
		if err := os.WriteFile(path, []byte(value), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, modTime, modTime); err != nil {
			t.Fatal(err)
		}
		return path
	}

	expired := writePoster("expired.jpg", "expired", now.Add(-40*24*time.Hour))
	recent := writePoster("recent.jpg", "recent", now.Add(-time.Hour))
	removed, err := service.prunePosterCache(context.Background(), now.Add(-30*24*time.Hour), 0)
	if err != nil || removed != 1 {
		t.Fatalf("expired prune removed=%d err=%v", removed, err)
	}
	if _, err := os.Stat(expired); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expired poster still exists: %v", err)
	}
	if _, err := os.Stat(recent); err != nil {
		t.Fatalf("recent poster removed: %v", err)
	}

	sizeRoot := t.TempDir()
	sizeService := New(Deps{DataDir: sizeRoot})
	sizeDir := filepath.Join(sizeRoot, PosterDirName, "workspace")
	if err := os.MkdirAll(sizeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeSizedPoster := func(name string, modTime time.Time) string {
		path := filepath.Join(sizeDir, name)
		if err := os.WriteFile(path, []byte("0123456789"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, modTime, modTime); err != nil {
			t.Fatal(err)
		}
		return path
	}
	oldest := writeSizedPoster("oldest.jpg", now.Add(-3*time.Hour))
	middle := writeSizedPoster("middle.jpg", now.Add(-2*time.Hour))
	newest := writeSizedPoster("newest.jpg", now.Add(-time.Hour))
	removed, err = sizeService.prunePosterCache(context.Background(), time.Time{}, 20)
	if err != nil || removed != 1 {
		t.Fatalf("size prune removed=%d err=%v", removed, err)
	}
	if _, err := os.Stat(oldest); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("oldest poster still exists: %v", err)
	}
	for _, path := range []string{middle, newest} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("newer poster removed: %v", err)
		}
	}
}
