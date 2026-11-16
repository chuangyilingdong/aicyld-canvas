package project

import (
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) ListSmartFilmBatches(userID, status string, page, pageSize int) (SmartFilmBatchListPage, error) {
	status = strings.TrimSpace(status)
	if status != "" && status != smartFilmBatchStatusDraft && status != smartFilmBatchStatusConfirmed && status != smartFilmBatchStatusPartiallyConfirmed {
		return SmartFilmBatchListPage{}, kernel.BadAuthRequest("批次状态无效")
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	batches, total, err := s.repo.SmartFilmBatchesForUser(userID, status, page, pageSize)
	if err != nil {
		return SmartFilmBatchListPage{}, err
	}
	items := make([]SmartFilmBatchView, 0, len(batches))
	for _, batch := range batches {
		view, viewErr := s.smartFilmBatchSummaryResponse(batch)
		if viewErr != nil {
			return SmartFilmBatchListPage{}, viewErr
		}
		items = append(items, view)
	}
	return SmartFilmBatchListPage{
		Batches: items, Page: page, PageSize: pageSize, Total: total,
		HasMore: int64(page*pageSize) < total,
	}, nil
}

func (s *Service) smartFilmBatchSummaryResponse(batch model.SmartFilmBatch) (SmartFilmBatchView, error) {
	view, err := s.smartFilmBatchResponse(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	if view.Config.SkillSnapshot != nil {
		snapshot := *view.Config.SkillSnapshot
		snapshot.Stages = nil
		snapshot.StageFiles = nil
		view.Config.SkillSnapshot = &snapshot
	}
	return view, nil
}

func (s *Service) DeleteSmartFilmBatch(userID, batchID string) error {
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return err
	}
	scripts, err := s.smartFilmScripts(batch)
	if err != nil {
		return err
	}
	runs, err := s.repo.SmartFilmProductionRunsForBatch(userID, batchID)
	if err != nil {
		return err
	}
	for _, run := range runs {
		if run.AssetStatus == "queued" || run.AssetStatus == "running" || run.StoryboardStatus == "queued" || run.StoryboardStatus == "running" {
			return kernel.BadAuthRequest("批次仍有生成中的任务，请等待任务结束后再删除")
		}
	}
	projectIDs := make([]string, 0, len(scripts))
	for _, script := range scripts {
		if strings.TrimSpace(script.ProjectID) != "" {
			projectIDs = append(projectIDs, script.ProjectID)
		}
	}
	if len(projectIDs) > 0 {
		activeTasks, countErr := s.repo.ActiveTaskCountForProjectIDs(userID, projectIDs)
		if countErr != nil {
			return countErr
		}
		if activeTasks > 0 {
			return kernel.BadAuthRequest("批次项目仍有生成中的任务，请等待任务结束后再删除")
		}
	}
	if err := s.repo.DeleteSmartFilmBatch(userID, batchID); err != nil {
		if s.repo != nil {
			return mapProjectWriteError(err)
		}
		return err
	}
	return nil
}
