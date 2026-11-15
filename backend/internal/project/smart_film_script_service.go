package project

import (
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func (s *Service) UpdateSmartFilmBatchScript(userID, batchID, scriptID string, req UpdateSmartFilmBatchScriptRequest) (SmartFilmBatchView, error) {
	if req.ExpectedRevision <= 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请刷新后再修改剧本")
	}
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	if batch.Revision != req.ExpectedRevision {
		return SmartFilmBatchView{}, kernel.WrapAppError(kernel.CodeConflict, "批次已发生变化，请刷新后重试", nil)
	}
	scripts, err := s.smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	index := smartFilmScriptIndex(scripts, scriptID)
	if index < 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本不存在，请刷新后重试")
	}
	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	if title == "" || content == "" {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本标题和正文不能为空")
	}
	if len([]rune(content)) > 30000 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("单条剧本不能超过 30000 个字符")
	}
	nextStatus := strings.TrimSpace(req.Status)
	if nextStatus == "" {
		nextStatus = scripts[index].Status
		if scripts[index].ProjectID == "" {
			nextStatus = SmartFilmScriptStatusDraft
		}
	}
	if !validSmartFilmScriptStatus(nextStatus) {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本状态无效")
	}
	contentChanged := scripts[index].Content != content
	hadProject := strings.TrimSpace(scripts[index].ProjectID) != ""
	scripts[index].Title = truncateSmartFilmText(title, 240)
	scripts[index].Content = content
	scripts[index].Status = nextStatus
	scripts[index].Error = ""
	if taskID := strings.TrimSpace(req.TaskID); taskID != "" {
		scripts[index].TaskID = taskID
	}
	scripts[index].UpdatedAt = time.Now()
	var updated *model.SmartFilmBatch
	err = s.repo.Transaction(func(txRepo *repository.Repository) error {
		var updateErr error
		updated, updateErr = txRepo.UpdateSmartFilmBatch(userID, batchID, req.ExpectedRevision, map[string]any{
			"scripts_json": "[]",
			"status":       smartFilmBatchStatus(scripts),
		})
		if updateErr != nil {
			return mapProjectWriteError(updateErr)
		}
		if err := txRepo.UpdateSmartFilmScript(userID, batchID, smartFilmScriptRecord(scripts[index], userID, batchID, index), req.ExpectedScriptRevision); err != nil {
			return mapSmartFilmScriptWriteError(err)
		}
		if contentChanged && !hadProject {
			if _, archiveErr := txRepo.ArchiveUnprojectedSmartFilmProductionRunsForScript(userID, batchID, scriptID, smartFilmArchiveReasonRegenerated); archiveErr != nil {
				return archiveErr
			}
		}
		return nil
	})
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	return s.smartFilmBatchResponse(*updated)
}

func (s *Service) DeleteSmartFilmBatchScript(userID, batchID, scriptID string, expectedRevision int64) (SmartFilmBatchView, error) {
	if expectedRevision <= 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请刷新后再删除剧本")
	}
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	scripts, err := s.smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	next := make([]SmartFilmScript, 0, len(scripts))
	found := false
	for _, script := range scripts {
		if script.ID == scriptID {
			found = true
			if script.ProjectID != "" {
				return SmartFilmBatchView{}, kernel.BadAuthRequest("已经创建视频项目的剧本不能删除")
			}
			continue
		}
		next = append(next, script)
	}
	if !found {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本不存在，请刷新后重试")
	}
	runs, err := s.repo.SmartFilmProductionRunsForBatch(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	for _, run := range runs {
		if run.ScriptID == scriptID && strings.TrimSpace(run.ProjectID) != "" {
			return SmartFilmBatchView{}, kernel.BadAuthRequest("已经创建视频项目的剧本不能删除")
		}
	}
	var updated *model.SmartFilmBatch
	err = s.repo.Transaction(func(txRepo *repository.Repository) error {
		var updateErr error
		updated, updateErr = txRepo.UpdateSmartFilmBatch(userID, batchID, expectedRevision, map[string]any{
			"scripts_json": "[]",
			"status":       smartFilmBatchStatus(next),
		})
		if updateErr != nil {
			return mapProjectWriteError(updateErr)
		}
		if deleteErr := txRepo.DeleteSmartFilmScript(userID, batchID, scriptID); deleteErr != nil {
			return deleteErr
		}
		if _, deleteErr := txRepo.DeleteOrphanSmartFilmProductionRunsForScript(userID, batchID, scriptID); deleteErr != nil {
			return deleteErr
		}
		return nil
	})
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	return s.smartFilmBatchResponse(*updated)
}
