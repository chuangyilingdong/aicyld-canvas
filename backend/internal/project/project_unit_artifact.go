package project

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) ProjectUnitArtifacts(userID, projectID, unitID string) ([]model.ProjectUnitArtifact, error) {
	if _, err := s.Owned(userID, projectID); err != nil {
		return nil, err
	}
	if _, err := s.repo.ProjectUnit(projectID, unitID); err != nil {
		return nil, err
	}
	return s.repo.ProjectUnitArtifacts(projectID, unitID)
}

func (s *Service) RegisterProjectUnitArtifact(userID, projectID, unitID string, req RegisterProjectUnitArtifactRequest) (model.ProjectUnitArtifact, error) {
	if _, err := s.Owned(userID, projectID); err != nil {
		return model.ProjectUnitArtifact{}, err
	}
	if _, err := s.repo.ProjectUnit(projectID, unitID); err != nil {
		return model.ProjectUnitArtifact{}, err
	}
	taskID := strings.TrimSpace(req.TaskID)
	resourceID := strings.TrimSpace(req.ResourceID)
	artifactType := strings.TrimSpace(req.Type)
	if artifactType == "" {
		artifactType = "smart_film"
	}
	if artifactType != "smart_film" {
		return model.ProjectUnitArtifact{}, kernel.BadAuthRequest("项目级产物类型无效")
	}
	if taskID == "" || resourceID == "" {
		return model.ProjectUnitArtifact{}, kernel.BadAuthRequest("任务和资源不能为空")
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return model.ProjectUnitArtifact{}, err
	}
	if task.ProjectID != "" && task.ProjectID != projectID {
		return model.ProjectUnitArtifact{}, kernel.BadAuthRequest("任务不属于当前项目")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return model.ProjectUnitArtifact{}, err
	}
	if resource.Kind != "video" {
		return model.ProjectUnitArtifact{}, kernel.BadAuthRequest("成片产物必须是视频资源")
	}
	metadata := strings.TrimSpace(req.MetadataJSON)
	if metadata == "" {
		metadata = "{}"
	}
	if len([]byte(metadata)) > 256<<10 || !json.Valid([]byte(metadata)) {
		return model.ProjectUnitArtifact{}, kernel.BadAuthRequest("项目级产物元数据格式无效")
	}
	now := time.Now()
	artifact := model.ProjectUnitArtifact{
		ID: kernel.NewID(), TaskID: taskID, ResourceID: resourceID, Type: artifactType,
		MetadataJSON: metadata, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateProjectUnitArtifactActive(userID, projectID, unitID, &artifact); err != nil {
		return model.ProjectUnitArtifact{}, mapProjectWriteError(err)
	}
	return artifact, nil
}
