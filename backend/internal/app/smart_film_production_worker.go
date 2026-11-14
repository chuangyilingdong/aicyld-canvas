package app

import (
	"context"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/smartfilm"
	localtask "infinite-canvas/backend/internal/task"
)

func (s *Service) startSmartFilmProductionWorker(ctx context.Context) {
	if s == nil || s.repo == nil || s.projectDomain() == nil {
		return
	}
	s.smartFilmWorkerOnce.Do(func() {
		s.smartFilmWorker = smartfilm.New(s.projectDomain(), s.repo, func(userID string, req localtask.CreateRequest) (*model.Task, error) {
			return s.taskDomain().CreateTask(userID, req)
		}, s.log)
	})
	if s.smartFilmWorker != nil {
		s.smartFilmWorker.Start(ctx)
	}
}
