package protocol

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func numericText(value any) string {
	return fmt.Sprintf("%v", value)
}

// 平台渠道的音频协议包 async-audio 必须按上游 ZhenZhen AI 的
// POST /v1/audio/generations 契约发请求（不是 OpenAI 同步 TTS /v1/audio/speech）：
// prompt 是要念的文本，音色/格式/语速放在 metadata 里，产物读 data.result_url。
func TestSeedanceAudioPackageMatchesUpstreamContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "async-audio", "manifest.json"))
	if err != nil {
		t.Fatalf("读取音频协议包失败: %v", err)
	}
	adapter, err := LoadManifest(raw)
	if err != nil {
		t.Fatalf("加载音频协议包失败: %v", err)
	}
	if adapter.Metadata().ID != "async-audio" {
		t.Fatalf("provider id = %q", adapter.Metadata().ID)
	}

	// 1) 画布默认音色（OpenAI 名字）不能透传给上游：上游只认豆包音色 ID，
	//    传 alloy 会直接失败（speaker alloy not found），必须省略走默认音色。
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "doubao-seed-audio-1.0", Prompt: "你好，这是音频测试。",
		Extra: map[string]any{"audioVoice": "alloy", "audioFormat": "mp3", "audioSpeed": "1"},
	}})
	if err != nil {
		t.Fatalf("BuildCreate 失败: %v", err)
	}
	if create.Path != "/v1/audio/generations" {
		t.Fatalf("create path = %q", create.Path)
	}
	body := create.Body.(map[string]any)
	if body["prompt"] != "你好，这是音频测试。" || body["model"] != "doubao-seed-audio-1.0" {
		t.Fatalf("body = %#v", body)
	}
	metadata, _ := body["metadata"].(map[string]any)
	if _, exists := metadata["speaker"]; exists {
		t.Fatalf("OpenAI 音色不得透传: %#v", metadata)
	}
	if metadata["format"] != "mp3" || metadata["sample_rate"] != "24000" {
		t.Fatalf("metadata = %#v", metadata)
	}
	if _, exists := metadata["speech_rate"]; exists {
		t.Fatalf("1.0 倍速不必发 speech_rate: %#v", metadata)
	}

	// 2) 豆包音色 ID 透传；opus 映射成 ogg_opus；1.25 倍速 → speech_rate 25
	withVoice, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "doubao-seed-audio-1.0", Prompt: "音色测试",
		Extra: map[string]any{"audioVoice": "zh_male_shaonianzixin_uranus_bigtts", "audioFormat": "opus", "audioSpeed": "1.25"},
	}})
	if err != nil {
		t.Fatalf("BuildCreate(音色) 失败: %v", err)
	}
	voiceMeta := withVoice.Body.(map[string]any)["metadata"].(map[string]any)
	if voiceMeta["speaker"] != "zh_male_shaonianzixin_uranus_bigtts" {
		t.Fatalf("音色 = %#v", voiceMeta["speaker"])
	}
	if voiceMeta["format"] != "ogg_opus" {
		t.Fatalf("opus 应映射成 ogg_opus: %#v", voiceMeta["format"])
	}
	if numericText(voiceMeta["speech_rate"]) != "25" {
		t.Fatalf("语速 = %#v", voiceMeta["speech_rate"])
	}

	// 3) 上游不支持的格式回退 mp3，超范围语速被夹到 -50..100
	fallback, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "doubao-seed-audio-1.0", Prompt: "格式回退",
		Extra: map[string]any{"audioFormat": "aac", "audioSpeed": "4"},
	}})
	if err != nil {
		t.Fatalf("BuildCreate(回退) 失败: %v", err)
	}
	fallbackMeta := fallback.Body.(map[string]any)["metadata"].(map[string]any)
	if fallbackMeta["format"] != "mp3" {
		t.Fatalf("aac 应回退 mp3: %#v", fallbackMeta["format"])
	}
	if numericText(fallbackMeta["speech_rate"]) != "100" {
		t.Fatalf("4 倍速应夹到 100: %#v", fallbackMeta["speech_rate"])
	}

	// 4) 轮询与产物：SUCCESS + data.result_url（上游真实响应形状）
	poll, err := adapter.BuildPoll(context.Background(), PollContext{Model: "doubao-seed-audio-1.0", TaskID: "task_1"})
	if err != nil {
		t.Fatalf("BuildPoll 失败: %v", err)
	}
	if poll.Path != "/v1/audio/generations/task_1" {
		t.Fatalf("poll path = %q", poll.Path)
	}
	polled, err := adapter.ParsePoll(context.Background(), PollContext{Model: "doubao-seed-audio-1.0", TaskID: "task_1"},
		[]byte(`{"code":"success","data":{"task_id":"task_1","status":"SUCCESS","progress":"100%","result_url":"https://cdn.example/a.mp3","usage":{"amount":0.02}}}`))
	if err != nil {
		t.Fatalf("ParsePoll 失败: %v", err)
	}
	if polled.Status != StatusSucceeded {
		t.Fatalf("status = %v", polled.Status)
	}
	if polled.Result == nil || len(polled.Result.Audios) != 1 || polled.Result.Audios[0].URL != "https://cdn.example/a.mp3" {
		t.Fatalf("result = %#v", polled.Result)
	}

	// 5) 失败态：FAILURE + fail_reason 要能读出原因
	failed, err := adapter.ParsePoll(context.Background(), PollContext{Model: "doubao-seed-audio-1.0", TaskID: "task_2"},
		[]byte(`{"data":{"task_id":"task_2","status":"FAILURE","fail_reason":"speaker alloy not found"}}`))
	if err != nil {
		t.Fatalf("ParsePoll(失败) 失败: %v", err)
	}
	if failed.Status != StatusFailed {
		t.Fatalf("status = %v", failed.Status)
	}
}
