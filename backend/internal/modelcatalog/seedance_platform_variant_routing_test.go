package modelcatalog

import (
	"encoding/json"
	"os"
	"testing"
)

// 临时校验（不入库）：拿生产上真实的平台渠道配置 + 新的 intent 选择器，
// 确认「用户选的生成模式」决定上游 SKU，而不是参考图片数量。
func TestLivePlatformVariantRouting(t *testing.T) {
	raw, err := os.ReadFile("/srv/aicyld/canvas/data/platform-channels.json")
	if err != nil {
		t.Skipf("跳过：%v", err)
	}
	var doc struct {
		Channels []struct {
			ID      string `json:"id"`
			Models  []struct {
				Model    string `json:"model"`
				Capab    string `json:"capability"`
				Variants []struct {
					Selector         map[string]string `json:"selector"`
					ProviderModelKey string            `json:"providerModelKey"`
				} `json:"variants"`
				ProviderModelKey string `json:"providerModelKey"`
			} `json:"modelProfiles"`
		} `json:"channels"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("解析失败: %v", err)
	}

	cases := []struct {
		name      string
		operation string
		images    int
		videos    int
		want      string
	}{
		{"文生视频", "text_to_video", 0, 0, "seedance-2.0-standard-t2v"},
		{"图生视频(1 图)", "image_to_video", 1, 0, "seedance-2.0-standard-i2v"},
		{"首尾帧(2 图)", "first_last_frame", 2, 0, "seedance-2.0-standard-i2v"},
		{"全能参考(2 图)", "reference_to_video", 2, 0, "seedance-2.0-standard-multi"},
		{"全能参考(1 图)", "reference_to_video", 1, 0, "seedance-2.0-standard-multi"},
		{"全能参考(带参考视频)", "reference_to_video", 1, 1, "seedance-2.0-standard-multi"},
		{"没声明模式但有图", "", 2, 0, "seedance-2.0-standard-i2v"},
		{"没声明模式但有视频", "", 0, 1, "seedance-2.0-standard-multi"},
	}
	for _, profile := range doc.Channels[0].Models {
		if profile.Model != "seedance-2.0-standard" {
			continue
		}
		for _, tc := range cases {
			intent := ModelRequestIntent{
				Capability: "video",
				Operation:  tc.operation,
				Inputs:     map[string]int{"image": tc.images, "video": tc.videos},
				Options:    map[string]any{},
			}
			selector := SKUSelectorForIntent(intent)
			best := ""
			bestScore := -1
			for _, variant := range profile.Variants {
				ok, score := MatchSKUSelector(variant.Selector, selector)
				if ok && score > bestScore {
					best, bestScore = variant.ProviderModelKey, score
				}
			}
			if best == "" {
				best = profile.ProviderModelKey
			}
			if best != tc.want {
				t.Errorf("%s: selector=%v -> %s, want %s", tc.name, selector, best, tc.want)
			} else {
				t.Logf("%s: %v -> %s", tc.name, selector, best)
			}
		}
	}
}
