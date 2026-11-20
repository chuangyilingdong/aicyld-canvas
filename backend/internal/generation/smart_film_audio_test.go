package generation

import (
	"context"
	"errors"
	"os"
	"testing"

	"infinite-canvas/backend/internal/mediatools"
)

func TestSmartFilmNativeAudioInspectionPreservesVideoWithoutPaidFallback(t *testing.T) {
	for _, test := range []struct {
		name    string
		audio   bool
		failure bool
		want    string
	}{{"present", true, false, "present"}, {"missing", false, false, "missing"}, {"probe-error", false, true, "unverified"}} {
		t.Run(test.name, func(t *testing.T) {
			video := map[string]any{"dataUrl": DataURL("video/mp4", []byte("sample"))}
			input := Input{Mode: "video", Config: Config{VideoGenerateAudio: "true"}, Metadata: map[string]any{"source": "smart-film-whole-video"}}
			probe := func(_ context.Context, path string) (mediatools.MediaMetadata, error) {
				data, err := os.ReadFile(path)
				if err != nil || string(data) != "sample" {
					t.Fatalf("probe input=%q err=%v", data, err)
				}
				if test.failure {
					return mediatools.MediaMetadata{}, errors.New("unavailable")
				}
				return mediatools.MediaMetadata{HasVideo: true, HasAudio: test.audio}, nil
			}
			inspectSmartFilmNativeAudio(context.Background(), input, map[string]any{"video": video}, probe)
			if video["audioStatus"] != test.want || video["dataUrl"] == nil {
				t.Fatalf("result=%+v", video)
			}
			if test.want == "present" && video["audioWarning"] != nil {
				t.Fatalf("unexpected warning=%v", video["audioWarning"])
			}
			if test.want != "present" && video["audioWarning"] == nil {
				t.Fatal("missing inspection warning")
			}
		})
	}
}

func TestSmartFilmNativeAudioDoesNotProbeSilentOrUnrelatedTasks(t *testing.T) {
	for _, input := range []Input{{Mode: "video", Config: Config{VideoGenerateAudio: "false"}, Metadata: map[string]any{"source": "smart-film-whole-video"}}, {Mode: "video", Config: Config{VideoGenerateAudio: "true"}, Metadata: map[string]any{"source": "ordinary"}}} {
		inspectSmartFilmNativeAudio(context.Background(), input, map[string]any{"video": map[string]any{}}, func(context.Context, string) (mediatools.MediaMetadata, error) {
			t.Fatal("must not probe")
			return mediatools.MediaMetadata{}, nil
		})
	}
}
