package generation

import (
	"context"
	"encoding/base64"
	"io"
	"os"
	"strings"

	"infinite-canvas/backend/internal/mediatools"
)

func inspectSmartFilmNativeAudio(ctx context.Context, input Input, result map[string]any, probe func(context.Context, string) (mediatools.MediaMetadata, error)) {
	source := metadataString(input.Metadata, "source")
	if input.Mode != "video" || !ParseBool(input.Config.VideoGenerateAudio, false) || (source != "smart-film-whole-video" && source != "short-drama-workflow") {
		return
	}
	video, ok := result["video"].(map[string]any)
	if !ok {
		return
	}
	video["audioStatus"] = "unverified"
	video["audioWarning"] = "原生音轨暂未完成校验，请预览确认。未自动追加付费配音。"
	_, encoded, ok := SplitDataURL(stringField(video, "dataUrl"))
	if !ok {
		return
	}
	file, err := os.CreateTemp("", "smart-film-audio-*.mp4")
	if err != nil {
		return
	}
	defer os.Remove(file.Name())
	_, copyErr := io.Copy(file, base64.NewDecoder(base64.StdEncoding, strings.NewReader(encoded)))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		return
	}
	facts, err := probe(ctx, file.Name())
	if err != nil || !facts.HasVideo {
		return
	}
	if facts.HasAudio {
		video["audioStatus"] = "present"
		delete(video, "audioWarning")
	} else {
		video["audioStatus"] = "missing"
		video["audioWarning"] = "模型返回的视频缺少原生音轨，视频已保留。未自动追加付费配音，请确认后选择后续处理。"
	}
}
