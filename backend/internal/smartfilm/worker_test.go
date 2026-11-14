package smartfilm

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	localproject "infinite-canvas/backend/internal/project"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestWorkerProcessSubmitsAndCompletesStoryboardWithEncryptedCustomConfig(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	project := model.Project{ID: "process-project", UserID: "process-user", Name: "异步分镜", Type: "smart-film", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	unit := model.ProjectUnit{ID: "process-unit", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "第一场", SourceText: "角色走进房间。", Status: model.ProjectUnitStatusReady, Position: 0, CreatedAt: now, UpdatedAt: now}
	scripts, _ := json.Marshal([]localproject.SmartFilmScript{{ID: "process-script", Title: "第一场", Content: unit.SourceText, Status: localproject.SmartFilmScriptStatusAssetsExtracted, ProjectID: project.ID, UnitID: unit.ID, CreatedAt: now, UpdatedAt: now}})
	batch := model.SmartFilmBatch{ID: "process-batch", UserID: project.UserID, Title: "异步批次", SourceText: "想法", ConfigJSON: `{"shotCount":1,"shotDurationSeconds":5,"defaultTextModel":"text-model"}`, OrchestrationConfigCipher: "encrypted", ScriptsJSON: string(scripts), Status: "confirmed", Revision: 1, CreatedAt: now, UpdatedAt: now}
	run := model.SmartFilmProductionRun{ID: "process-run", UserID: project.UserID, BatchID: batch.ID, ScriptID: "process-script", IdempotencyKey: "process-run-key", Status: localproject.SmartFilmProductionRunStatusReady, CurrentStep: localproject.SmartFilmProductionStepStoryboard, ProjectID: project.ID, UnitID: unit.ID, AssetStatus: localproject.SmartFilmProductionStageStatusConfirmed, StoryboardStatus: localproject.SmartFilmProductionStageStatusQueued, ControlStatus: localproject.SmartFilmProductionControlActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	var decryptErr error
	projects := localproject.New(repo, localproject.Dependencies{DecryptSecret: func(string) (string, error) {
		if decryptErr != nil {
			return "", decryptErr
		}
		return `{"text":{"model":"text-model","apiKey":"sk-worker-secret","logicalModelId":"logical-text"}}`, nil
	}})
	var captured localtask.CreateRequest
	submitted := 0
	worker := New(projects, repo, func(userID string, req localtask.CreateRequest) (*model.Task, error) {
		submitted++
		captured = req
		resultJSON, _ := json.Marshal(map[string]any{"text": `{"title":"第一场","rows":[{"shotNumber":1,"durationSeconds":5,"plotDescription":"角色走进房间","dialogue":"到了","characters":[],"imageGenerationPrompt":"角色走进房间","videoMotionPrompt":"角色停步","assetRefs":[]}]}`})
		inputJSON, _ := json.Marshal(req.Input)
		task := model.Task{ID: "process-task", UserID: userID, ProjectID: req.ProjectID, Type: req.Type, Operation: req.Operation, Status: model.TaskStatusSucceeded, ResultJSON: string(resultJSON), InputJSON: string(inputJSON), CreatedAt: now, UpdatedAt: now}
		if err := db.Create(&task).Error; err != nil {
			return nil, err
		}
		return &task, nil
	}, nil)
	decryptErr = errors.New("密钥已过期")
	if err := worker.ProcessOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	storedRun, err := repo.SmartFilmProductionRunForUser(project.UserID, batch.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedRun.StoryboardStatus != localproject.SmartFilmProductionStageStatusAttention || storedRun.FailedStep != localproject.SmartFilmProductionStepStoryboard || submitted != 0 {
		t.Fatalf("expired config run = %+v, submitted = %d", storedRun, submitted)
	}
	decryptErr = nil
	if err := db.Model(&model.SmartFilmProductionRun{}).Where("id = ?", run.ID).Updates(map[string]any{
		"status": localproject.SmartFilmProductionRunStatusReady, "storyboard_status": localproject.SmartFilmProductionStageStatusQueued,
		"failed_step": "", "error": "", "recoverable_action": "",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := worker.ProcessOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	storedRun, err = repo.SmartFilmProductionRunForUser(project.UserID, batch.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedRun.StoryboardTaskID != "process-task" || storedRun.StoryboardStatus != localproject.SmartFilmProductionStageStatusRunning {
		t.Fatalf("submitted run = %+v", storedRun)
	}
	config, _ := captured.Input["config"].(map[string]any)
	if config["apiKey"] != "sk-worker-secret" || captured.LogicalModelID != "logical-text" {
		t.Fatalf("captured custom config = %+v, logical = %q", config, captured.LogicalModelID)
	}
	if err := worker.ProcessOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	shots, err := repo.ProjectUnitShots(project.ID, unit.ID)
	if err != nil || len(shots) != 1 {
		t.Fatalf("shots = %+v, err = %v", shots, err)
	}
	storedRun, err = repo.SmartFilmProductionRunForUser(project.UserID, batch.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedRun.StoryboardStatus != localproject.SmartFilmProductionStageStatusReady || storedRun.StoryboardShotCount != 1 {
		t.Fatalf("completed run = %+v", storedRun)
	}
}

func TestSplitModelOption(t *testing.T) {
	channel, model := SplitModelOption("channel-1::text-model")
	if channel != "channel-1" || model != "text-model" {
		t.Fatalf("split = %q/%q", channel, model)
	}
	channel, model = SplitModelOption("text-only")
	if channel != "" || model != "text-only" {
		t.Fatalf("plain split = %q/%q", channel, model)
	}
}

func TestDecodeAssetResultJSON(t *testing.T) {
	payload, err := DecodeJSONObject("```json\n{\"characters\":[],\"scenes\":[{\"name\":\"车站\"}],\"props\":[]}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if len(JSONArray(payload["scenes"])) != 1 || JSONString(JSONMap(JSONArray(payload["scenes"])[0])["name"]) != "车站" {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestWorkerStoryboardWritesShotsAndCheckpointsRun(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	project := model.Project{ID: "worker-project", UserID: "worker-user", Name: "独立视频", Type: "smart-film", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	unit := model.ProjectUnit{ID: "worker-unit", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "第一场", SourceText: "角色推门进入房间。", Status: model.ProjectUnitStatusReady, Position: 0, CreatedAt: now, UpdatedAt: now}
	scriptsJSON, _ := json.Marshal([]localproject.SmartFilmScript{{ID: "worker-script", Title: "第一场", Content: "角色推门进入房间。", Status: localproject.SmartFilmScriptStatusAssetsExtracted, ProjectID: project.ID, UnitID: unit.ID, CreatedAt: now, UpdatedAt: now}})
	batch := model.SmartFilmBatch{ID: "worker-batch", UserID: project.UserID, Title: "批次", SourceText: "想法", ScriptsJSON: string(scriptsJSON), Status: "confirmed", Revision: 1, CreatedAt: now, UpdatedAt: now}
	run := model.SmartFilmProductionRun{ID: "worker-run", UserID: project.UserID, BatchID: batch.ID, ScriptID: "worker-script", IdempotencyKey: "worker-run-key", Status: localproject.SmartFilmProductionRunStatusReady, CurrentStep: localproject.SmartFilmProductionStepStoryboard, ProjectID: project.ID, UnitID: unit.ID, AssetStatus: localproject.SmartFilmProductionStageStatusConfirmed, StoryboardStatus: localproject.SmartFilmProductionStageStatusRunning, ControlStatus: localproject.SmartFilmProductionControlActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	resultJSON, _ := json.Marshal(map[string]any{"text": `{"title":"第一场","rows":[{"shotNumber":1,"durationSeconds":5,"plotDescription":"角色拿着产品A推门进入房间","dialogue":"我回来了","characters":[],"narrativeIntent":"建立进入动作","performanceBlocking":"角色从画面左侧推门进入","shotSize":"中景","emotion":"克制","lightingAndAtmosphere":"暖色室内光","audioEffects":"门轴声","camera":"固定机位","motion":"轻推门","timeBeats":"推门-停顿","imageGenerationPrompt":"角色拿着产品A推门进入暖光房间","videoMotionPrompt":"门缓慢打开，角色停在门边","continuityOut":"门保持打开","negativePrompt":"换脸","mustHave":["推门"],"optionalDetails":[],"assetRefs":[]}]}`})
	task := model.Task{ID: "worker-task", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_text", Operation: "storyboard", Status: model.TaskStatusSucceeded, ResultJSON: string(resultJSON), InputJSON: `{"metadata":{"domainProjectId":"worker-project","chapterId":"worker-unit","source":"smart-film-batch-worker"}}`, CreatedAt: now, UpdatedAt: now}
	productA := model.Asset{ID: "asset-product-a", UserID: project.UserID, Kind: "image", Category: model.AssetCategoryProp, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "version-a", Title: "产品A", PayloadJSON: `{"id":"asset-product-a"}`, CreatedAt: now, UpdatedAt: now}
	productB := model.Asset{ID: "asset-product-b", UserID: project.UserID, Kind: "image", Category: model.AssetCategoryProp, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "version-b", Title: "产品B", PayloadJSON: `{"id":"asset-product-b"}`, CreatedAt: now, UpdatedAt: now}
	versionA := model.AssetVersion{ID: "version-a", AssetID: productA.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`, CreatedAt: now, UpdatedAt: now}
	versionB := model.AssetVersion{ID: "version-b", AssetID: productB.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`, CreatedAt: now, UpdatedAt: now}
	linkA := model.ProjectAssetLink{ID: "link-a", ProjectID: project.ID, AssetID: productA.ID, Position: 0, CreatedAt: now}
	linkB := model.ProjectAssetLink{ID: "link-b", ProjectID: project.ID, AssetID: productB.ID, Position: 1, CreatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{&productA, &productB, &versionA, &versionB, &linkA, &linkB} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := repository.New(db)
	projects := localproject.New(repo, localproject.Dependencies{})
	worker := New(projects, repo, func(string, localtask.CreateRequest) (*model.Task, error) { return nil, nil }, nil)
	item := localproject.SmartFilmStoryboardWorkItem{
		RunID: run.ID, UserID: project.UserID, BatchID: batch.ID, ScriptID: "worker-script",
		ProjectID: project.ID, UnitID: unit.ID, ProjectRevision: project.Revision, ScriptTitle: "第一场", ScriptContent: unit.SourceText,
		TextModel: "text-model", ShotCount: 1, ShotDurationSeconds: 5, ShotDurationsSeconds: []float64{7}, StoryboardTaskID: task.ID,
		Assets: []localproject.SmartFilmStoryboardAsset{
			{ID: productA.ID, Title: productA.Title, Category: string(productA.Category), MediaType: "image", PrimaryVersionID: versionA.ID, Prompt: "产品A外观"},
			{ID: productB.ID, Title: productB.Title, Category: string(productB.Category), MediaType: "image", PrimaryVersionID: versionB.ID, Prompt: "产品B外观"},
		},
	}
	if err := worker.pollStoryboard(item); err != nil {
		t.Fatal(err)
	}
	shots, err := repo.ProjectUnitShots(project.ID, unit.ID)
	if err != nil || len(shots) != 1 {
		t.Fatalf("shots = %+v, err = %v", shots, err)
	}
	if shots[0].DurationMs != 7000 {
		t.Fatalf("shot duration = %d, want configured 7000ms", shots[0].DurationMs)
	}
	var revision model.ShotRevision
	if err := db.First(&revision, "shot_id = ?", shots[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if revision.Dialogue != "我回来了" || !strings.Contains(revision.ImagePrompt, "角色拿着产品A推门进入暖光房间") || !strings.Contains(revision.ImagePrompt, "@[asset:asset-product-a]") {
		t.Fatalf("revision = %+v", revision)
	}
	var references []model.ShotAssetReference
	if err := db.Where("shot_id = ?", shots[0].ID).Find(&references).Error; err != nil {
		t.Fatal(err)
	}
	if len(references) != 1 || references[0].AssetVersionID != versionA.ID {
		t.Fatalf("references = %+v, want only product A", references)
	}
	updatedRun, err := repo.SmartFilmProductionRunForUser(project.UserID, batch.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updatedRun.StoryboardStatus != localproject.SmartFilmProductionStageStatusReady || updatedRun.StoryboardShotCount != 1 {
		t.Fatalf("run = %+v", updatedRun)
	}
}
