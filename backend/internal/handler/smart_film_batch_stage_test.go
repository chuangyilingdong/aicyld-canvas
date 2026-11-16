package handler

import (
	"testing"

	localproject "infinite-canvas/backend/internal/project"
)

func TestTrimSmartFilmBatchSkillStageKeepsOnlyRequestedStage(t *testing.T) {
	view := localproject.SmartFilmBatchView{Config: localproject.SmartFilmBatchConfig{SkillSnapshot: &localproject.SmartFilmSkillSnapshot{
		Stages: map[string]string{"image": "image rules", "storyboard": "storyboard rules", "video": "video rules"},
		StageFiles: map[string][]string{"image": {"image.md"}, "storyboard": {"storyboard.md"}, "video": {"video.md"}},
	}}}
	trimmed := trimSmartFilmBatchSkillStage(view, "image")
	if trimmed.Config.SkillSnapshot == nil || len(trimmed.Config.SkillSnapshot.Stages) != 1 || trimmed.Config.SkillSnapshot.Stages["image"] != "image rules" {
		t.Fatalf("trimmed stages = %+v", trimmed.Config.SkillSnapshot)
	}
	if len(trimmed.Config.SkillSnapshot.StageFiles) != 1 || len(trimmed.Config.SkillSnapshot.StageFiles["image"]) != 1 {
		t.Fatalf("trimmed stage files = %+v", trimmed.Config.SkillSnapshot.StageFiles)
	}
	if len(view.Config.SkillSnapshot.Stages) != 3 {
		t.Fatal("trimming mutated the source view")
	}
}
