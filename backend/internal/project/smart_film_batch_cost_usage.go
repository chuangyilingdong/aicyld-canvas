package project

import (
	"encoding/json"
	"sort"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type smartFilmTaskStageUsage struct {
	shotIDs    map[string]struct{}
	untargeted int
}

func (usage smartFilmTaskStageUsage) hasAny() bool {
	return len(usage.shotIDs) > 0 || usage.untargeted > 0
}

func mapSmartFilmTaskWorkUsage(rows []repository.SmartFilmBatchTaskWorkCount) map[string]map[string]smartFilmTaskStageUsage {
	usage := make(map[string]map[string]smartFilmTaskStageUsage)
	for _, row := range rows {
		if usage[row.ProjectID] == nil {
			usage[row.ProjectID] = make(map[string]smartFilmTaskStageUsage)
		}
		stageUsage := usage[row.ProjectID][row.Stage]
		if row.ShotID == "" {
			stageUsage.untargeted += row.TaskCount
		} else {
			if stageUsage.shotIDs == nil {
				stageUsage.shotIDs = make(map[string]struct{})
			}
			stageUsage.shotIDs[row.ShotID] = struct{}{}
		}
		usage[row.ProjectID][row.Stage] = stageUsage
	}
	return usage
}

func remainingSmartFilmWork(expected int, usage smartFilmTaskStageUsage) int {
	remaining := expected - len(usage.shotIDs) - usage.untargeted
	if remaining < 0 {
		return 0
	}
	return remaining
}

func (s *Service) mergeSmartFilmReadyWork(projectID, unitID string, usage map[string]smartFilmTaskStageUsage) ([]model.Shot, error) {
	shots, err := s.repo.ProjectUnitShots(projectID, unitID)
	if err != nil {
		return nil, err
	}
	revisions := make(map[string]string, len(shots))
	for _, shot := range shots {
		revisions[shot.ID] = shot.CurrentRevisionID
	}
	artifacts, err := s.repo.ProjectUnitShotArtifacts(projectID, unitID)
	if err != nil {
		return nil, err
	}
	for _, artifact := range artifacts {
		if artifact.Status != "ready" || artifact.ResourceID == "" {
			continue
		}
		revision, exists := revisions[artifact.ShotID]
		if !exists || artifact.RevisionID != revision {
			continue
		}
		stage := map[string]string{"storyboard": "image", "video": "video"}[artifact.Type]
		if artifact.Type == "audio" {
			var metadata struct {
				AudioPurpose string `json:"audioPurpose"`
			}
			_ = json.Unmarshal([]byte(artifact.MetadataJSON), &metadata)
			switch metadata.AudioPurpose {
			case "voice":
				stage = "narration"
			case "music":
				stage = "bgm"
			}
		}
		if stage == "" {
			continue
		}
		current := usage[stage]
		if current.shotIDs == nil {
			current.shotIDs = make(map[string]struct{})
		}
		current.shotIDs[artifact.ShotID] = struct{}{}
		usage[stage] = current
	}
	unitArtifacts, err := s.repo.ProjectUnitArtifacts(projectID, unitID)
	if err != nil {
		return nil, err
	}
	for _, artifact := range unitArtifacts {
		if artifact.Type == "smart_film" && artifact.Status == "ready" && artifact.ResourceID != "" {
			usage["whole_video"] = smartFilmTaskStageUsage{untargeted: 1}
			break
		}
	}
	return shots, nil
}

type smartFilmDurationCount struct {
	Seconds float64
	Count   int
}

func smartFilmRemainingVideoDurations(config SmartFilmBatchConfig, shots []model.Shot, usage smartFilmTaskStageUsage) []smartFilmDurationCount {
	count := config.ShotCount
	if count < 1 {
		count = 1
	}
	if len(shots) > 0 {
		count = len(shots)
	}
	untargeted := usage.untargeted
	if len(shots) == 0 {
		untargeted += len(usage.shotIDs)
	}
	counts := make(map[float64]int)
	for index := 0; index < count; index++ {
		seconds := config.ShotDurationSeconds
		if index < len(config.ShotDurationsSeconds) {
			seconds = config.ShotDurationsSeconds[index]
		}
		if len(shots) > 0 {
			if _, exists := usage.shotIDs[shots[index].ID]; exists {
				continue
			}
			if shots[index].DurationMs > 0 {
				seconds = float64(shots[index].DurationMs) / 1000
			}
		}
		if untargeted > 0 {
			untargeted--
			continue
		}
		counts[seconds]++
	}
	durations := make([]smartFilmDurationCount, 0, len(counts))
	for seconds, n := range counts {
		durations = append(durations, smartFilmDurationCount{seconds, n})
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i].Seconds < durations[j].Seconds })
	return durations
}
