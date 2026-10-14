package protocol

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 平台渠道的视频协议包 openai-videos（provider id = newapi）必须按上游 ZhenZhen AI 的
// /v1/videos 契约发图：i2v 用顶层 images 数组（1 张首帧 / 2 张首帧+尾帧），
// 多素材参考（>2 张图或带参考视频/音频）才用 metadata.content。
// 曾经用 OpenAI Sora 的 multipart 文件字段 input_reference，上游一律回
// 「image-to-video requires at least one input image」（2026-10-14 生产事故）。
func TestSeedanceVideoPackageSendsImagesPerUpstreamContract(t *testing.T) {
	manifestPath := filepath.Join("..", "..", "..", "plugin-packages", "openai-videos", "manifest.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("读取协议包失败: %v", err)
	}
	adapter, err := LoadManifest(raw)
	if err != nil {
		t.Fatalf("加载协议包失败: %v", err)
	}
	if adapter.Metadata().ID != "newapi" {
		t.Fatalf("provider id = %q", adapter.Metadata().ID)
	}

	dataURL := "data:image/png;base64,AAAA"

	// 单图：图生视频（首帧）
	single, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "seedance-2.0-standard-i2v", Prompt: "@图片1 这只猫在跳舞", Duration: 5,
		Resolution: "480p", AspectRatio: "16:9", GenerateAudio: true,
		Images: []MediaReference{{DataURL: dataURL, Kind: "image"}},
	}})
	if err != nil {
		t.Fatalf("BuildCreate(单图) 失败: %v", err)
	}
	body, ok := single.Body.(map[string]any)
	if !ok {
		t.Fatalf("body = %#v", single.Body)
	}
	if _, exists := body["input_reference"]; exists {
		t.Fatal("不得再发 Sora 的 multipart 文件字段")
	}
	images, _ := body["images"].([]any)
	if len(images) != 1 || images[0] != dataURL {
		t.Fatalf("images = %#v", body["images"])
	}
	if body["seconds"] != "5" || body["prompt"] != "@图片1 这只猫在跳舞" {
		t.Fatalf("body = %#v", body)
	}
	metadata, _ := body["metadata"].(map[string]any)
	if metadata["resolution"] != "480p" || metadata["ratio"] != "16:9" || metadata["generate_audio"] != true {
		t.Fatalf("metadata = %#v", metadata)
	}
	if content, exists := metadata["content"]; exists && content != nil {
		t.Fatalf("单图不得走 metadata.content: %#v", content)
	}

	// 两图：首尾帧，仍在顶层 images
	two, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "seedance-2.0-standard-i2v", Prompt: "首尾帧", Duration: 5,
		Images: []MediaReference{{DataURL: dataURL, Kind: "image"}, {DataURL: dataURL, Kind: "image"}},
	}})
	if err != nil {
		t.Fatalf("BuildCreate(两图) 失败: %v", err)
	}
	twoBody := two.Body.(map[string]any)
	if got := twoBody["images"].([]any); len(got) != 2 {
		t.Fatalf("两图 images = %#v", got)
	}

	// 三图 + 参考视频：多素材参考走 metadata.content，images 不再出现
	multi, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "seedance-2.5-standard-multi", Prompt: "多素材", Duration: 8, AspectRatio: "16:9",
		Images: []MediaReference{{DataURL: dataURL, Kind: "image"}, {DataURL: dataURL, Kind: "image"}, {DataURL: dataURL, Kind: "image"}},
		Videos: []MediaReference{{URL: "https://cdn.example/ref.mp4", Kind: "video"}},
	}})
	if err != nil {
		t.Fatalf("BuildCreate(多素材) 失败: %v", err)
	}
	multiBody := multi.Body.(map[string]any)
	if _, exists := multiBody["images"]; exists {
		t.Fatalf("多素材不应再发顶层 images: %#v", multiBody["images"])
	}
	multiMetadata, _ := multiBody["metadata"].(map[string]any)
	entries, _ := multiMetadata["content"].([]any)
	if len(entries) != 4 {
		t.Fatalf("metadata.content = %#v", multiMetadata["content"])
	}
	first, _ := entries[0].(map[string]any)
	if first["type"] != "image_url" || first["role"] != "reference_image" {
		t.Fatalf("首个 content 项 = %#v", first)
	}
	imageURL, _ := first["image_url"].(map[string]any)
	if imageURL["url"] != dataURL {
		t.Fatalf("content 图片地址 = %#v", imageURL)
	}
	lastEntry, _ := entries[3].(map[string]any)
	if lastEntry["type"] != "video_url" || lastEntry["role"] != "reference_video" {
		t.Fatalf("视频 content 项 = %#v", lastEntry)
	}

	// 文生视频：不带图，metadata 也不该出现 content
	text, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "seedance-2.0-standard-t2v", Prompt: "航拍山谷", Duration: 4, AspectRatio: "16:9",
	}})
	if err != nil {
		t.Fatalf("BuildCreate(文生) 失败: %v", err)
	}
	textBody := text.Body.(map[string]any)
	if _, exists := textBody["images"]; exists {
		t.Fatalf("文生视频不得带 images: %#v", textBody["images"])
	}
	if textMetadata, _ := textBody["metadata"].(map[string]any); textMetadata["content"] != nil {
		if _, exists := textMetadata["content"]; exists {
			t.Fatalf("文生视频不得带 metadata.content: %#v", textMetadata["content"])
		}
	}

	// 全能参考：只有 2 张图也必须走 metadata.content（上游 multi 档）。
	// 这是「模式决定模型，而不是参考图数量」的关键路径——用户在画布上选全能参考 +
	// 2 张参考图时，以前会因为图片少而被当成图生视频（首尾帧）发出去。
	refTwo, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "seedance-2.0-standard-multi", Prompt: "两张参考图的全能参考", Duration: 5, Operation: "reference_to_video",
		Images: []MediaReference{{DataURL: dataURL, Kind: "image"}, {DataURL: dataURL, Kind: "image"}},
	}})
	if err != nil {
		t.Fatalf("BuildCreate(全能参考两图) 失败: %v", err)
	}
	refTwoBody := refTwo.Body.(map[string]any)
	if _, exists := refTwoBody["images"]; exists {
		t.Fatalf("全能参考不得发顶层 images: %#v", refTwoBody["images"])
	}
	refTwoContent, _ := refTwoBody["metadata"].(map[string]any)["content"].([]any)
	if len(refTwoContent) != 2 {
		t.Fatalf("全能参考 metadata.content = %#v", refTwoBody["metadata"])
	}
	refEntry, _ := refTwoContent[0].(map[string]any)
	if refEntry["type"] != "image_url" || refEntry["role"] != "reference_image" {
		t.Fatalf("全能参考首个 content 项 = %#v", refEntry)
	}

	// 首尾帧（用户显式选模式，2 张图）：仍走顶层 images，上游按首帧+尾帧读取
	frames, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "seedance-2.0-standard-i2v", Prompt: "首尾帧过渡", Duration: 5, Operation: "first_last_frame",
		Images: []MediaReference{{DataURL: dataURL, Kind: "image"}, {DataURL: dataURL, Kind: "image"}},
	}})
	if err != nil {
		t.Fatalf("BuildCreate(首尾帧) 失败: %v", err)
	}
	if got := frames.Body.(map[string]any)["images"].([]any); len(got) != 2 {
		t.Fatalf("首尾帧 images = %#v", got)
	}

	// 轮询与下载仍走 GET /v1/videos/{id}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{Model: "seedance-2.0-standard-i2v", TaskID: "task_1"})
	if err != nil {
		t.Fatalf("BuildPoll 失败: %v", err)
	}
	if !strings.Contains(poll.Path, "/v1/videos/") {
		t.Fatalf("poll path = %q", poll.Path)
	}
}
