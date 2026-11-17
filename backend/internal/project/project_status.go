package project

import (
	"fmt"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func (s *Service) projectStatusForProject(userID string, project model.Project) (StatusSnapshot, error) {
	metrics, activeTasks, mode, err := s.projectStatusInputs(userID, project)
	if err != nil {
		return StatusSnapshot{}, err
	}
	return buildProjectStatus(project, metrics, activeTasks, mode), nil
}

func (s *Service) projectStatusInputs(userID string, project model.Project) (repository.ProjectOverviewMetrics, int64, string, error) {
	metrics, err := s.repo.ProjectOverviewMetrics(project.ID)
	if err != nil {
		return repository.ProjectOverviewMetrics{}, 0, "", err
	}
	activeTasks, err := s.repo.ActiveTaskCountForProjectIDs(userID, []string{project.ID})
	if err != nil {
		return repository.ProjectOverviewMetrics{}, 0, "", err
	}
	mode := SmartFilmProductionModeFixed
	if project.BatchID != "" {
		if batch, batchErr := s.repo.SmartFilmBatchForUser(userID, project.BatchID); batchErr == nil {
			if config, configErr := smartFilmBatchConfig(batch); configErr == nil && config.ProductionMode != "" {
				mode = config.ProductionMode
			}
		}
	}
	return metrics, activeTasks, mode, nil
}

func buildProjectStatus(project model.Project, metrics repository.ProjectOverviewMetrics, activeTasks int64, productionMode string) StatusSnapshot {
	status := StatusSnapshot{
		ProductionMode:        productionMode,
		ActiveTaskCount:       activeTasks,
		FailedStepCount:       metrics.FailedWorkflowStepCount,
		PendingCandidateCount: metrics.PendingCandidateCount,
		StaleArtifactCount:    metrics.StaleArtifactCount,
	}
	status.DeliveryReady = activeTasks == 0 && metrics.PendingCandidateCount == 0 && metrics.StaleArtifactCount == 0 &&
		((productionMode == SmartFilmProductionModeSmart && metrics.ShotCount > 0 &&
			metrics.ReadyStoryboardCount == metrics.ShotCount && metrics.ReadySmartFilmCount > 0) ||
			(productionMode != SmartFilmProductionModeSmart &&
				((metrics.ShotCount > 0 && metrics.ReadyVideoCount == metrics.ShotCount) || metrics.TimelineRenderSucceededCount > 0)))
	if project.Status == model.ProjectStatusArchived {
		status.Label, status.Detail, status.Tone = "已归档", "恢复项目后可继续制作", "archived"
		return status
	}
	if metrics.FailedWorkflowStepCount > 0 {
		status.Label, status.Detail, status.Tone = "需要处理", fmt.Sprintf("%d 个制作步骤失败", metrics.FailedWorkflowStepCount), "attention"
		return status
	}
	if status.DeliveryReady {
		status.Label, status.Detail, status.Tone = "可交付", deliveryDetail(productionMode), "ready"
		return status
	}
	if activeTasks > 0 {
		status.Label, status.Detail, status.Tone = "生成中", fmt.Sprintf("%d 个生成任务正在运行", activeTasks), "generating"
		return status
	}
	if metrics.PendingCandidateCount > 0 {
		status.Label, status.Detail, status.Tone = "资产待确认", fmt.Sprintf("%d 个资产候选待确认", metrics.PendingCandidateCount), "attention"
		return status
	}
	if metrics.StaleArtifactCount > 0 {
		status.Label, status.Detail, status.Tone = "产物待更新", fmt.Sprintf("%d 个产物已过期", metrics.StaleArtifactCount), "attention"
		return status
	}
	if metrics.UnitCount == 0 {
		status.Label, status.Detail, status.Tone = "准备故事", "添加或导入剧情章节", "draft"
		return status
	}
	if metrics.ShotCount == 0 {
		status.Label, status.Detail, status.Tone = "分镜准备", "选择章节生成镜头", "in-progress"
		return status
	}
	if metrics.CompletedUnitCount > 0 && metrics.CompletedUnitCount == metrics.UnitCount {
		status.Label, status.Detail, status.Tone = "检查交付", "章节已完成，可检查最终产物", "ready"
		return status
	}
	status.Label, status.Detail, status.Tone = "制作中", fmt.Sprintf("%d 个镜头已建立", metrics.ShotCount), "in-progress"
	return status
}

func deliveryDetail(productionMode string) string {
	if productionMode == SmartFilmProductionModeSmart {
		return "当前分镜对应的整片视频已生成"
	}
	return "当前镜头或时间线交付产物已完成"
}
