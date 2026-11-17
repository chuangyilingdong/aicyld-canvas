package project

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestBuildProjectStatusRequiresCurrentDeliveryInputs(t *testing.T) {
	project := model.Project{Status: model.ProjectStatusActive}
	metrics := repository.ProjectOverviewMetrics{
		UnitCount:                    1,
		CompletedUnitCount:           1,
		ShotCount:                    3,
		ReadyVideoCount:              2,
		TimelineRenderSucceededCount: 1,
		StaleArtifactCount:           1,
	}
	status := buildProjectStatus(project, metrics, 0, SmartFilmProductionModeFixed)
	if status.Label != "产物待更新" || status.Tone != "attention" || status.DeliveryReady {
		t.Fatalf("status = %+v, want stale attention", status)
	}
}

func TestBuildProjectStatusUsesSmartFilmDelivery(t *testing.T) {
	project := model.Project{Status: model.ProjectStatusActive}
	metrics := repository.ProjectOverviewMetrics{
		UnitCount:            1,
		CompletedUnitCount:   1,
		ShotCount:            3,
		ReadyStoryboardCount: 3,
		ReadySmartFilmCount:  1,
	}
	status := buildProjectStatus(project, metrics, 0, SmartFilmProductionModeSmart)
	if status.Label != "可交付" || status.Tone != "ready" || !status.DeliveryReady {
		t.Fatalf("status = %+v, want smart film ready", status)
	}
}

func TestBuildProjectStatusPrioritizesFailuresAndActiveWork(t *testing.T) {
	project := model.Project{Status: model.ProjectStatusActive}
	failed := buildProjectStatus(project, repository.ProjectOverviewMetrics{FailedWorkflowStepCount: 1}, 1, SmartFilmProductionModeFixed)
	if failed.Label != "需要处理" || failed.Tone != "attention" {
		t.Fatalf("failed status = %+v", failed)
	}
	generating := buildProjectStatus(project, repository.ProjectOverviewMetrics{UnitCount: 1}, 2, SmartFilmProductionModeFixed)
	if generating.Label != "生成中" || generating.Tone != "generating" {
		t.Fatalf("generating status = %+v", generating)
	}
}
