package smartfilm

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
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
	"infinite-canvas/backend/internal/testutil"
)

func TestWorkerProcessSubmitsAndCompletesStoryboardWithEncryptedCustomConfig(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	testutil.CloseDBOnCleanup(t, db)
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
	if err := db.Create(&model.SmartFilmScriptRecord{
		ID: "process-script", UserID: project.UserID, BatchID: batch.ID, Position: 0, Title: "第一场",
		Content: unit.SourceText, Status: localproject.SmartFilmScriptStatusAssetsExtracted,
		ProjectID: project.ID, UnitID: unit.ID, Revision: 1, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
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
	if prompt, _ := captured.Input["prompt"].(string); !strings.Contains(prompt, "角色走进房间") || !strings.Contains(prompt, "只返回一个 JSON") {
		t.Fatalf("storyboard prompt was not passed to the model: %q", prompt)
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

func TestAssetExtractionCandidateInputsKeepsFixedCharacterCast(t *testing.T) {
	payload := map[string]any{
		"characters": []any{
			map[string]any{"name": "小满"},
			map[string]any{"name": "阿豆"},
		},
		"scenes": []any{map[string]any{"name": "发光水母灯海", "description": "海底灯海", "prompt": "海底灯海"}},
		"props":  []any{map[string]any{"name": "手电", "description": "手电", "prompt": "手电"}},
	}
	inputs := assetExtractionCandidateInputs(localproject.SmartFilmAssetExtractionWorkItem{
		UnitID: "unit-1", FixedCharacterCount: 2,
	}, payload)
	if len(inputs) != 2 {
		t.Fatalf("candidate count = %d, want scene and prop only", len(inputs))
	}
	for _, input := range inputs {
		if input.Category == "character" {
			t.Fatalf("fixed character cast leaked back as candidate: %+v", input)
		}
	}
}

func TestWorkerAssetFailureKeepsTaskIDForRetry(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	testutil.CloseDBOnCleanup(t, db)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	project := model.Project{ID: "asset-failure-project", UserID: "asset-failure-user", Name: "资产失败", Type: "smart-film", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	unit := model.ProjectUnit{ID: "asset-failure-unit", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "第一场", SourceText: "角色走进房间。", Status: model.ProjectUnitStatusReady, Position: 0, CreatedAt: now, UpdatedAt: now}
	scripts, _ := json.Marshal([]localproject.SmartFilmScript{{ID: "asset-failure-script", Title: "第一场", Content: unit.SourceText, Status: localproject.SmartFilmScriptStatusProjectCreated, ProjectID: project.ID, UnitID: unit.ID, CreatedAt: now, UpdatedAt: now}})
	batch := model.SmartFilmBatch{ID: "asset-failure-batch", UserID: project.UserID, Title: "资产失败批次", SourceText: "想法", ConfigJSON: `{"defaultTextModel":"text-model"}`, ScriptsJSON: string(scripts), Status: "confirmed", Revision: 1, CreatedAt: now, UpdatedAt: now}
	run := model.SmartFilmProductionRun{
		ID: "asset-failure-run", UserID: project.UserID, BatchID: batch.ID, ScriptID: "asset-failure-script", IdempotencyKey: "asset-failure-key",
		Status: localproject.SmartFilmProductionRunStatusReady, CurrentStep: localproject.SmartFilmProductionStepAssets,
		ProjectID: project.ID, UnitID: unit.ID, AssetStatus: localproject.SmartFilmProductionStageStatusQueued,
		AssetTaskID: "asset-failure-task", ControlStatus: localproject.SmartFilmProductionControlActive, Attempts: 1,
		Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	task := model.Task{ID: "asset-failure-task", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_text", Operation: assetExtractionOperation, Status: model.TaskStatusFailed, Error: "上游资产提取失败", CreatedAt: now, UpdatedAt: now}
	for _, row := range []any{&project, &unit, &batch, &run, &task} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.SmartFilmScriptRecord{
		ID: "asset-failure-script", UserID: project.UserID, BatchID: batch.ID, Position: 0, Title: "第一场",
		Content: unit.SourceText, Status: localproject.SmartFilmScriptStatusProjectCreated,
		ProjectID: project.ID, UnitID: unit.ID, Revision: 1, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	projects := localproject.New(repo, localproject.Dependencies{})
	submitted := 0
	worker := New(projects, repo, func(string, localtask.CreateRequest) (*model.Task, error) {
		submitted++
		return nil, errors.New("不应提交新任务")
	}, nil)
	if err := worker.ProcessOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.SmartFilmProductionRunForUser(project.UserID, batch.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.AssetStatus != localproject.SmartFilmProductionStageStatusAttention || stored.AssetTaskID != task.ID || stored.FailedStep != localproject.SmartFilmProductionStepAssets || stored.Error == "" {
		t.Fatalf("failed asset run = %+v", stored)
	}
	if submitted != 0 {
		t.Fatalf("submitted %d tasks after a failed asset result", submitted)
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

func TestWorkerStoryboardUsesAttemptScopedOperationID(t *testing.T) {
	var captured localtask.CreateRequest
	worker := &Worker{SubmitTask: func(userID string, req localtask.CreateRequest) (*model.Task, error) {
		captured = req
		return &model.Task{ID: "task-1", UserID: userID}, nil
	}}
	item := localproject.SmartFilmStoryboardWorkItem{
		RunID: "run-1", Attempts: 2, UserID: "user-1", ProjectID: "project-1", UnitID: "unit-1",
		TextModel: "text-model", ShotCount: 1, ShotDurationSeconds: 5,
	}
	if _, err := worker.submitStoryboard(item); err != nil {
		t.Fatal(err)
	}
	metadata := captured.Input["metadata"].(map[string]any)
	if got := metadata["clientOperationId"]; got != "smart-film:storyboard:run-1:2" {
		t.Fatalf("clientOperationId = %v", got)
	}
}

func TestWorkerStoryboardUsesOnePinnedSkillContext(t *testing.T) {
	var captured localtask.CreateRequest
	worker := &Worker{SubmitTask: func(userID string, req localtask.CreateRequest) (*model.Task, error) {
		captured = req
		return &model.Task{ID: "task-1", UserID: userID}, nil
	}}
	item := localproject.SmartFilmStoryboardWorkItem{
		RunID: "run-1", Attempts: 1, UserID: "user-1", ProjectID: "project-1", UnitID: "unit-1",
		TextModel: "text-model", ShotCount: 1, ShotDurationSeconds: 5,
		SkillID: "skill-one", SkillVersionID: "version-one", SkillContentHash: "hash-one", SkillContext: "只加载这一个技能包规则",
	}
	if _, err := worker.submitStoryboard(item); err != nil {
		t.Fatal(err)
	}
	metadata := captured.Input["metadata"].(map[string]any)
	if metadata["skillId"] != "skill-one" || metadata["skillVersionId"] != "version-one" {
		t.Fatalf("skill metadata = %+v", metadata)
	}
	if metadata["skillContext"] != "只加载这一个技能包规则" {
		t.Fatalf("skill context metadata = %+v", metadata)
	}
}

func TestValidateStoryboardCharacterBindingsAcceptsNamedTextSetting(t *testing.T) {
	assets := []localproject.SmartFilmStoryboardAsset{
		{ID: "linmo", Title: "林默", Category: "character", VisualReference: true},
	}
	if err := validateStoryboardCharacterBindings(map[string]any{"characters": []any{"林默"}}, assets); err != nil {
		t.Fatal(err)
	}
	if err := validateStoryboardCharacterBindings(map[string]any{"characters": []any{"林默", "陌生人"}}, assets); err == nil {
		t.Fatal("unknown character name was accepted")
	}
	assets[0].VisualReference = false
	if err := validateStoryboardCharacterBindings(map[string]any{"characters": []any{"林默"}}, assets); err != nil {
		t.Fatalf("named text-only character was rejected: %v", err)
	}
}

func TestStoryboardRowAssetsIgnoresTextOnlySettings(t *testing.T) {
	assets := []localproject.SmartFilmStoryboardAsset{
		{ID: "text-setting", Title: "雨夜街角", Category: "environment", MediaType: "text", VisualReference: false, PrimaryVersionID: "text-v1", Prompt: "潮湿的街道和霓虹灯"},
		{ID: "product-image", Title: "咖啡杯", Category: "prop", MediaType: "image", VisualReference: true, PrimaryVersionID: "image-v1", Prompt: "白色陶瓷咖啡杯"},
	}
	row := map[string]any{
		"plotDescription": "雨夜街角，角色举起咖啡杯",
		"assetRefs": []any{
			map[string]any{"nodeId": "text-setting", "role": "environment"},
			map[string]any{"nodeId": "product-image", "role": "prop"},
		},
	}
	ids, versions, roles := storyboardRowAssets(row, assets)
	if len(ids) != 1 || ids[0] != "product-image" || len(versions) != 1 || versions[0] != "image-v1" {
		t.Fatalf("ids=%v versions=%v", ids, versions)
	}
	if len(roles) != 1 || roles[0].AssetID != "product-image" || roles[0].Role != "prop" {
		t.Fatalf("roles=%+v", roles)
	}
}

func TestStoryboardRowAssetsIncludesAllSameNameCharacterViews(t *testing.T) {
	assets := []localproject.SmartFilmStoryboardAsset{
		{ID: "linmo-front", Title: "林默", Category: "character", MediaType: "image", VisualReference: true, PrimaryVersionID: "front-v1"},
		{ID: "linmo-side", Title: "林默", Category: "character", MediaType: "image", VisualReference: true, PrimaryVersionID: "side-v1"},
		{ID: "linmo-three-quarter", Title: "林默", Category: "character", MediaType: "image", VisualReference: true, PrimaryVersionID: "three-quarter-v1"},
	}
	ids, versions, roles := storyboardRowAssets(map[string]any{
		"characters": []any{"林默"},
		"assetRefs":  []any{map[string]any{"nodeId": "linmo-front", "role": "character"}},
	}, assets)
	if len(ids) != 3 || len(versions) != 3 || len(roles) != 3 {
		t.Fatalf("same-name character views were not all bound: ids=%v versions=%v roles=%v", ids, versions, roles)
	}
	for _, id := range []string{"linmo-front", "linmo-side", "linmo-three-quarter"} {
		if !slices.Contains(ids, id) {
			t.Fatalf("missing character view %s in %v", id, ids)
		}
	}
}

func TestStoryboardRowAssetsBindsEveryViewSharingAProductAlias(t *testing.T) {
	assets := []localproject.SmartFilmStoryboardAsset{
		{ID: "product-front", Title: "机甲狂鲨", Aliases: []string{"03"}, Category: "prop", MediaType: "image", VisualReference: true, PrimaryVersionID: "front-v1", InputRole: "product"},
		{ID: "product-side", Title: "机甲狂鲨", Aliases: []string{"生成图片"}, Category: "prop", MediaType: "image", VisualReference: true, PrimaryVersionID: "side-v1", InputRole: "product"},
	}
	ids, versions, roles := storyboardRowAssets(map[string]any{
		"plotDescription":       "巨型机甲狂鲨从海沟冲出",
		"imageGenerationPrompt": "机甲狂鲨保持银蓝装甲和双涡轮",
		"assetRefs":             []any{},
	}, assets)
	if len(ids) != 2 || !slices.Contains(ids, "product-front") || !slices.Contains(ids, "product-side") {
		t.Fatalf("product views were not both bound: ids=%v versions=%v roles=%v", ids, versions, roles)
	}
}

func TestAssetExtractionSkipsAlreadyMappedProductCandidate(t *testing.T) {
	item := localproject.SmartFilmAssetExtractionWorkItem{
		ExistingAssets: []localproject.SmartFilmStoryboardAsset{
			{ID: "product-front", Title: "机甲狂鲨", Category: "prop", MediaType: "image", VisualReference: true},
		},
	}
	candidates := assetExtractionCandidateInputs(item, map[string]any{
		"characters": []any{},
		"scenes":     []any{},
		"props":      []any{map[string]any{"name": "机甲狂鲨", "prompt": "产品设定"}},
	})
	if len(candidates) != 0 {
		t.Fatalf("mapped product candidate was duplicated: %+v", candidates)
	}
}

func TestSanitizeAssetMentionsDropsTextOnlyReferences(t *testing.T) {
	prompt := "雨夜街角 @[asset:text-setting] 咖啡杯 @[asset:product-image]"
	cleaned := sanitizeAssetMentions(prompt, []string{"product-image"})
	if strings.Contains(cleaned, "@[asset:text-setting]") {
		t.Fatalf("text-only mention remained: %q", cleaned)
	}
	if !strings.Contains(cleaned, "@[asset:product-image]") {
		t.Fatalf("visual mention removed: %q", cleaned)
	}
}

func TestWithAssetMentionsAppendsOnlyMissingReferences(t *testing.T) {
	prompt := withAssetMentions("林默 @[asset:character-front] 抬眼", []string{"character-front", "character-side", "scene"})
	if strings.Count(prompt, "@[asset:character-front]") != 1 {
		t.Fatalf("existing mention was duplicated: %q", prompt)
	}
	if !strings.Contains(prompt, "@[asset:character-side]") || !strings.Contains(prompt, "@[asset:scene]") {
		t.Fatalf("missing mentions were not appended: %q", prompt)
	}
	if got := withAssetMentions(prompt, []string{"character-front", "character-side", "scene"}); got != prompt {
		t.Fatalf("asset mention append is not idempotent: %q", got)
	}
}

func TestSmartFilmStageOperationIDKeepsInitialKeyStable(t *testing.T) {
	if got := smartFilmStageOperationID("assets", "run-1", 1); got != "smart-film:assets:run-1" {
		t.Fatalf("initial operation id = %q", got)
	}
	if got := smartFilmStageOperationID("assets", "run-1", 2); got != "smart-film:assets:run-1:2" {
		t.Fatalf("retry operation id = %q", got)
	}
}

func TestWorkerAssetExtractionCarriesChapterApplyOperation(t *testing.T) {
	var captured localtask.CreateRequest
	worker := &Worker{SubmitTask: func(_ string, req localtask.CreateRequest) (*model.Task, error) {
		captured = req
		return &model.Task{ID: "asset-task"}, nil
	}}
	_, err := worker.submitAssetExtraction(localproject.SmartFilmAssetExtractionWorkItem{
		RunID: "asset-run", UserID: "asset-user", BatchID: "asset-batch", ScriptID: "asset-script",
		ProjectID: "asset-project", UnitID: "asset-unit", ProjectName: "资产项目", ScriptTitle: "第一场",
		ScriptContent: "角色走进房间。", TextModel: "text-model", TextConfig: map[string]any{"model": "text-model"},
	})
	if err != nil {
		t.Fatal(err)
	}
	metadata, _ := captured.Input["metadata"].(map[string]any)
	if metadata["operation"] != assetExtractionOperation {
		t.Fatalf("asset extraction metadata = %+v", metadata)
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
	testutil.CloseDBOnCleanup(t, db)
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
	if err := db.Create(&model.SmartFilmScriptRecord{
		ID: "worker-script", UserID: project.UserID, BatchID: batch.ID, Position: 0, Title: "第一场",
		Content: unit.SourceText, Status: localproject.SmartFilmScriptStatusAssetsExtracted,
		ProjectID: project.ID, UnitID: unit.ID, Revision: 1, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
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
			{ID: productA.ID, Title: productA.Title, Category: string(productA.Category), MediaType: "image", VisualReference: true, PrimaryVersionID: versionA.ID, Prompt: "产品A外观"},
			{ID: productB.ID, Title: productB.Title, Category: string(productB.Category), MediaType: "image", VisualReference: true, PrimaryVersionID: versionB.ID, Prompt: "产品B外观"},
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

func TestStoryboardPromptCarriesProjectStyle(t *testing.T) {
	style := "项目统一画风：冷色电影感，低饱和，柔和高光，人物皮肤保留真实纹理"
	prompt := storyboardPrompt(localproject.SmartFilmStoryboardWorkItem{
		ScriptContent: "角色在雨夜街道停下。", ProjectStyle: style, ShotCount: 1, ShotDurationSeconds: 5,
	}, []byte("[]"))
	if !strings.Contains(prompt, "【项目画风】") || !strings.Contains(prompt, style) {
		t.Fatalf("storyboard prompt did not carry the selected project style: %s", prompt)
	}
	if !strings.Contains(prompt, "【当前可用资产】") || !strings.Contains(prompt, "visualReference=false 是仅文字设定") {
		t.Fatalf("storyboard prompt did not allow prompt-only assets: %s", prompt)
	}
}
