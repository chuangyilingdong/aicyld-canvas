package project

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestProjectUnitArtifactVersionsSmartFilmVideo(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "智能整片"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "第一场", SourceText: "故事"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	task := model.Task{ID: "smart-film-task", UserID: "user-1", ProjectID: project.ID, Type: "canvas_video", Status: model.TaskStatusSucceeded, CreatedAt: now, UpdatedAt: now}
	resource := model.Resource{ID: "smart-film-video", UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady, MimeType: "video/mp4", CreatedAt: now, UpdatedAt: now}
	for _, row := range []any{&task, &resource} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	first, err := svc.RegisterProjectUnitArtifact("user-1", project.ID, unit.ID, RegisterProjectUnitArtifactRequest{
		TaskID: task.ID, ResourceID: resource.ID, MetadataJSON: `{"model":"video-model"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Version != 1 || !first.Selected || first.ResourceID != resource.ID {
		t.Fatalf("first unit artifact = %+v", first)
	}
	second, err := svc.RegisterProjectUnitArtifact("user-1", project.ID, unit.ID, RegisterProjectUnitArtifactRequest{
		TaskID: task.ID, ResourceID: resource.ID, MetadataJSON: `{}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Version != 2 || !second.Selected {
		t.Fatalf("second unit artifact = %+v", second)
	}
	artifacts, err := svc.ProjectUnitArtifacts("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(artifacts) != 2 || artifacts[0].Version != 2 || artifacts[1].Version != 1 {
		t.Fatalf("unit artifacts = %+v", artifacts)
	}
}
