package app

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCreateTaskMediaTransportAdmission(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "preflight.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.LocalModels()...); err != nil {
		t.Fatal(err)
	}
	svc := NewLocal(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	request := CreateTaskRequest{Type: "canvas_video", Prompt: "move", Input: map[string]any{
		"mode": "video", "prompt": "move",
		"config":          map[string]any{"interfaceType": "newapi-channel-2", "model": "custom-video", "baseUrl": "https://custom.example/v1", "apiKey": "synthetic-key", "videoGenerateAudio": false},
		"referenceImages": []any{map[string]any{"storageKey": "resource:local-image"}},
	}}
	_, err = svc.CreateTask("user", request)
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Reason != "reference_media_requires_url" {
		t.Fatalf("wrong admission error: %v", err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("rejected task persisted: %d %v", count, err)
	}
	request.Input["referenceImages"] = []any{map[string]any{"url": "https://cdn.example/image.png"}}
	request.Input["mask"] = map[string]any{"storageKey": "resource:local-mask"}
	if _, err := svc.CreateTask("user", request); !errors.As(err, &appErr) || appErr.Reason != "reference_media_requires_url" {
		t.Fatalf("mask-only rejection missing: %v", err)
	}
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("mask rejection persisted: %d %v", count, err)
	}
	request.Input["mask"] = map[string]any{"url": "https://cdn.example/mask.png"}
	task, err := svc.CreateTask("user", request)
	if err != nil || task.Status != model.TaskStatusQueued {
		t.Fatalf("HTTPS task not accepted: %v", err)
	}
}

func TestTaskCapabilityInvalidConfigDoesNotSkipValidation(t *testing.T) {
	svc := &Service{}
	if err := svc.ValidateTaskCapability(map[string]any{"mode": "video", "config": map[string]any{"videoGenerateAudio": map[string]any{"bad": true}}}); err == nil {
		t.Fatal("malformed configuration skipped validation")
	}
}

func TestInvalidVideoCapabilityDoesNotCreateTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "capability-preflight.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.LocalModels()...); err != nil {
		t.Fatal(err)
	}
	svc := NewLocal(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })

	tests := []struct {
		name    string
		input   map[string]any
		wantErr string
	}{
		{
			name:    "Seedance 2.0 one second",
			input:   map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"interfaceType": "newapi", "model": "seedance-2.0-fast", "videoSeconds": "1", "size": "16:9", "vquality": "720p"}},
			wantErr: "视频时长",
		},
		{
			name:    "MiniMax H3 Max four seconds",
			input:   map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"interfaceType": "newapi-channel-2", "model": "minimax-h3-max", "videoSeconds": "4", "size": "16:9", "vquality": "480p"}},
			wantErr: "视频时长",
		},
		{
			name:    "Kling V3 two seconds",
			input:   map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"interfaceType": "newapi", "model": "kling-video-v3", "videoSeconds": "2", "size": "16:9", "vquality": "720p"}},
			wantErr: "视频时长",
		},
		{
			name:    "Grok Imagine two images",
			input:   map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"interfaceType": "newapi", "model": "grok-imagine-video-1.5", "videoSeconds": "5", "size": "16:9", "vquality": "720p"}, "referenceImages": []any{map[string]any{"url": "https://cdn.example/one.png"}, map[string]any{"url": "https://cdn.example/two.png"}}},
			wantErr: "参考图片",
		},
		{
			name:    "Wan 3.0 two images",
			input:   map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"interfaceType": "newapi-channel-2", "model": "wan3.0-video", "videoSeconds": "5", "size": "16:9", "vquality": "720p"}, "referenceImages": []any{map[string]any{"url": "https://cdn.example/one.png"}, map[string]any{"url": "https://cdn.example/two.png"}}},
			wantErr: "参考图片",
		},
		{
			name:    "MiniMax H3 Max 1080p",
			input:   map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"interfaceType": "newapi-channel-2", "model": "minimax-h3-max", "videoSeconds": "5", "size": "16:9", "vquality": "1080p"}},
			wantErr: "输出分辨率",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := svc.ValidateTaskCapability(test.input)
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("ValidateTaskCapability() error = %v, want %q", err, test.wantErr)
			}
			var count int64
			if err := db.Model(&model.Task{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("invalid capability persisted %d tasks", count)
			}
		})
	}
}
