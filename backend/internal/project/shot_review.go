package project

import (
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) ReviewProjectShot(userID, projectID, shotID string, req ReviewProjectShotRequest) (model.Shot, error) {
	status := strings.TrimSpace(req.Status)
	if status != "approved" && status != "rejected" {
		return model.Shot{}, kernel.BadAuthRequest("审核状态无效")
	}
	note := strings.TrimSpace(req.Note)
	if len([]rune(note)) > 4000 {
		return model.Shot{}, kernel.BadAuthRequest("审核意见不能超过 4000 个字符")
	}
	if status == "rejected" && note == "" {
		return model.Shot{}, kernel.BadAuthRequest("不通过时必须填写修改意见")
	}
	expectedRevisionID := strings.TrimSpace(req.ExpectedRevisionID)
	if expectedRevisionID == "" {
		return model.Shot{}, kernel.BadAuthRequest("请刷新后再提交审核")
	}
	shot, err := s.repo.ReviewShotActive(userID, projectID, strings.TrimSpace(shotID), expectedRevisionID, status, note, time.Now())
	if err != nil {
		return model.Shot{}, mapProjectWriteError(err)
	}
	return *shot, nil
}
