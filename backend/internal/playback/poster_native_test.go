package playback

import (
	"bytes"
	"context"
	"image"
	_ "image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestRunVideoPosterWithRealFFmpeg(t *testing.T) {
	binary, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg unavailable")
	}
	root := t.TempDir()
	source := filepath.Join(root, "source.mp4")
	command := exec.Command(binary,
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=red:s=320x180:d=0.5",
		"-c:v", "mpeg4", "-pix_fmt", "yuv420p", source,
	)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		t.Fatalf("create source: %v: %s", err, stderr.String())
	}
	destination := filepath.Join(root, "poster.jpg")
	if err := runVideoPoster(context.Background(), source, destination, 160); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	config, _, err := image.DecodeConfig(file)
	if err != nil {
		t.Fatal(err)
	}
	if config.Width != 160 || config.Height != 90 {
		t.Fatalf("poster dimensions = %dx%d, want 160x90", config.Width, config.Height)
	}
}
