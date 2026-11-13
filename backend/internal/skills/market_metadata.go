package skills

import (
	"encoding/json"
	"fmt"
	"strings"
)

// marketReleaseMetadataView is the subset of reviewed market metadata needed by
// the installed skill runtime. Keeping it local avoids coupling hosted skill
// execution to the desktop skillhub client.
type marketReleaseMetadataView struct {
	SkillID      string   `json:"skillId"`
	ReleaseID    string   `json:"releaseId"`
	Requirements []string `json:"requirements"`
}

func marketReleaseMetadata(raw string) (*marketReleaseMetadataView, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var release marketReleaseMetadataView
	if err := json.Unmarshal([]byte(raw), &release); err != nil {
		return nil, fmt.Errorf("读取技能市场版本资料失败: %w", err)
	}
	if release.SkillID == "" || release.ReleaseID == "" {
		return nil, fmt.Errorf("技能市场版本资料缺少发布身份")
	}
	return &release, nil
}
