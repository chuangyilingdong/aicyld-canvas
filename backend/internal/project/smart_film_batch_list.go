package project

import (
	"strings"

	"infinite-canvas/backend/internal/kernel"
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
		view, viewErr := s.smartFilmBatchResponse(batch)
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

func (s *Service) DeleteSmartFilmBatchDraft(userID, batchID string) error {
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return err
	}
	scripts, err := smartFilmScripts(batch)
	if err != nil {
		return err
	}
	for _, script := range scripts {
		if script.ProjectID != "" || script.Status != SmartFilmScriptStatusDraft {
			return kernel.BadAuthRequest("批次已经进入制作，不能删除")
		}
	}
	runs, err := s.repo.SmartFilmProductionRunsForBatch(userID, batchID)
	if err != nil {
		return err
	}
	if len(runs) > 0 {
		return kernel.BadAuthRequest("批次已有生产记录，不能删除")
	}
	if err := s.repo.DeleteSmartFilmBatchDraft(userID, batchID); err != nil {
		if s.repo != nil {
			return mapProjectWriteError(err)
		}
		return err
	}
	return nil
}
