package playback

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/mediatools"
	"infinite-canvas/backend/internal/model"
)

const (
	PosterDirName        = "video-posters"
	defaultPosterWidth   = 480
	minPosterWidth       = 64
	maxPosterWidth       = 1280
	posterCommandTimeout = 15 * time.Second
	posterCacheRetention = 30 * 24 * time.Hour
	posterCacheMaxBytes  = int64(256 << 20)
	posterPruneInterval  = 6 * time.Hour
)

var ErrPosterUnavailable = errors.New("video poster unavailable")

func normalizePosterWidth(width int) int {
	if width <= 0 {
		return defaultPosterWidth
	}
	if width < minPosterWidth {
		return minPosterWidth
	}
	if width > maxPosterWidth {
		return maxPosterWidth
	}
	return width
}

// Poster returns a cached JPEG extracted from an owned local video. Generation
// is bounded independently from playback transcodes so a burst of cards cannot
// fan out arbitrary FFmpeg processes.
func (s *Service) Poster(userID, resourceID string, width int) ([]byte, error) {
	if s == nil || s.store == nil || strings.TrimSpace(s.dataDir) == "" {
		return nil, fmt.Errorf("%w: playback service is not initialized", ErrPosterUnavailable)
	}
	resource, err := s.store.ResourceForUser(userID, resourceID)
	if err != nil {
		return nil, err
	}
	if resource == nil || resource.Kind != "video" || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return nil, fmt.Errorf("%w: owned video resource is not ready", ErrPosterUnavailable)
	}
	width = normalizePosterWidth(width)
	path, err := s.posterPath(resource, width)
	if err != nil {
		return nil, err
	}
	if cached, err := os.ReadFile(path); err == nil && len(cached) > 0 {
		s.schedulePosterPrune()
		return cached, nil
	}
	src, err := s.posterSourcePath(resource)
	if err != nil {
		return nil, err
	}
	baseContext := s.runContext(nil)
	if baseContext == nil || baseContext.Err() != nil {
		baseContext = context.Background()
	}
	select {
	case s.posterSlots <- struct{}{}:
		defer func() { <-s.posterSlots }()
	case <-baseContext.Done():
		return nil, fmt.Errorf("%w: runtime is stopping", ErrPosterUnavailable)
	}
	if cached, err := os.ReadFile(path); err == nil && len(cached) > 0 {
		s.schedulePosterPrune()
		return cached, nil
	}
	if err := ensureDir(filepath.Dir(path)); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(baseContext, posterCommandTimeout)
	defer cancel()
	temp, err := os.CreateTemp(filepath.Dir(path), ".poster-*.tmp")
	if err != nil {
		return nil, err
	}
	tempPath := temp.Name()
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return nil, err
	}
	defer os.Remove(tempPath)
	if err := s.renderPoster(ctx, src, tempPath, width); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPosterUnavailable, err)
	}
	info, err := os.Stat(tempPath)
	if err != nil || info.Size() == 0 {
		return nil, ErrPosterUnavailable
	}
	if err := os.Rename(tempPath, path); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err == nil {
		s.schedulePosterPrune()
	}
	return data, err
}

func (s *Service) schedulePosterPrune() {
	if s == nil || s.runner == nil {
		return
	}
	now := time.Now()
	s.posterPruneMu.Lock()
	if !s.lastPosterPrune.IsZero() && now.Sub(s.lastPosterPrune) < posterPruneInterval {
		s.posterPruneMu.Unlock()
		return
	}
	s.lastPosterPrune = now
	s.posterPruneMu.Unlock()
	accepted := s.runner.Go(func(ctx context.Context) {
		s.cacheMu.Lock()
		defer s.cacheMu.Unlock()
		_, _ = s.prunePosterCache(s.runContext(ctx), now.Add(-posterCacheRetention), posterCacheMaxBytes)
	})
	if !accepted {
		s.posterPruneMu.Lock()
		if s.lastPosterPrune.Equal(now) {
			s.lastPosterPrune = time.Time{}
		}
		s.posterPruneMu.Unlock()
	}
}

func (s *Service) prunePosterCache(ctx context.Context, cutoff time.Time, maxBytes int64) (int, error) {
	if s == nil || strings.TrimSpace(s.dataDir) == "" {
		return 0, nil
	}
	root := s.posterRoot()
	type entry struct {
		path    string
		size    int64
		modTime time.Time
	}
	entries := make([]entry, 0)
	var total int64
	err := filepath.WalkDir(root, func(path string, item os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if item.IsDir() || !item.Type().IsRegular() {
			return nil
		}
		info, err := item.Info()
		if err != nil {
			return err
		}
		entries = append(entries, entry{path: path, size: info.Size(), modTime: info.ModTime()})
		total += info.Size()
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].modTime.Before(entries[j].modTime)
	})
	removed := 0
	for _, item := range entries {
		if err := ctx.Err(); err != nil {
			return removed, err
		}
		expired := !cutoff.IsZero() && item.modTime.Before(cutoff)
		overLimit := maxBytes > 0 && total > maxBytes
		if !expired && !overLimit {
			continue
		}
		if err := os.Remove(item.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return removed, err
		}
		total -= item.size
		removed++
	}
	return removed, nil
}

func (s *Service) posterSourcePath(resource *model.Resource) (string, error) {
	if resource == nil {
		return "", ErrPosterUnavailable
	}
	candidates := make([]string, 0, 2)
	if resource.ObjectKey != "" {
		if path, err := s.sourcePath(resource.ObjectKey); err == nil {
			candidates = append(candidates, path)
		}
	}
	if resource.PlaybackObjectKey != "" && resource.PlaybackStatus == model.PlaybackStatusReady {
		if path, err := s.copyPath(resource.PlaybackObjectKey); err == nil {
			candidates = append(candidates, path)
		}
	}
	for _, path := range candidates {
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() && info.Size() > 0 {
			return path, nil
		}
	}
	return "", fmt.Errorf("%w: local video source is missing", ErrPosterUnavailable)
}

func (s *Service) posterRoot() string {
	return filepath.Join(s.dataDir, PosterDirName)
}

func (s *Service) posterPath(resource *model.Resource, width int) (string, error) {
	if resource == nil || strings.TrimSpace(resource.ID) == "" {
		return "", fmt.Errorf("%w: resource id is empty", ErrPosterUnavailable)
	}
	resourceKey := posterHash(resource.ID)
	versionKey := posterHash(strings.Join([]string{
		resource.ObjectKey,
		resource.ETag,
		resource.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}, "\x00"))
	return filepath.Join(s.posterRoot(), resourceKey, fmt.Sprintf("%s-%d.jpg", versionKey[:24], width)), nil
}

func (s *Service) clearPosterCache(resourceID string) (bool, error) {
	if s == nil || strings.TrimSpace(s.dataDir) == "" || strings.TrimSpace(resourceID) == "" {
		return false, nil
	}
	dir := filepath.Join(s.posterRoot(), posterHash(resourceID))
	relative, err := filepath.Rel(s.posterRoot(), dir)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return false, errors.New("poster cache path escapes its root")
	}
	if _, err := os.Stat(dir); errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if err := os.RemoveAll(dir); err != nil {
		return false, err
	}
	return true, nil
}

func posterHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func runVideoPoster(ctx context.Context, src, dst string, width int) error {
	if ctx == nil {
		ctx = context.Background()
	}
	binary, err := mediatools.ResolveFFmpeg()
	if err != nil {
		return err
	}
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y"}
	args = append(args,
		"-i", src,
		"-frames:v", "1",
		"-vf", fmt.Sprintf("scale='min(%d,iw)':-2", normalizePosterWidth(width)),
		"-q:v", "5",
		"-an", "-sn",
		"-f", "image2",
		dst,
	)
	cmd := exec.CommandContext(ctx, binary, args...)
	mediatools.HideConsole(cmd)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("ffmpeg poster: %s", clipText(message, 800))
	}
	file, err := os.Open(dst)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, _, err := image.DecodeConfig(file); err != nil {
		return fmt.Errorf("invalid poster image: %w", err)
	}
	return nil
}
