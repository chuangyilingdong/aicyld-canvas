package project

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"

	"gorm.io/gorm"
)

func TestSmartFilmBatchEncryptsOrchestrationConfigSnapshot(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	svc.encryptSecret = func(value string) (string, error) { return "enc:" + hex.EncodeToString([]byte(value)), nil }
	svc.decryptSecret = func(value string) (string, error) {
		if !strings.HasPrefix(value, "enc:") {
			t.Fatalf("unexpected ciphertext: %s", value)
		}
		decoded, err := hex.DecodeString(strings.TrimPrefix(value, "enc:"))
		return string(decoded), err
	}
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{
		Title: "加密配置", SourceText: "想法",
		OrchestrationConfig: map[string]any{
			"text":  map[string]any{"model": "text-model", "apiKey": "sk-private", "logicalModelId": "logical-text"},
			"video": map[string]any{"model": "video-model", "apiKey": "video-private"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var stored model.SmartFilmBatch
	if err := db.First(&stored, "id = ?", created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.OrchestrationConfigCipher, "private") || !strings.HasPrefix(stored.OrchestrationConfigCipher, "enc:") {
		t.Fatalf("orchestration snapshot was not encrypted: %q", stored.OrchestrationConfigCipher)
	}
	snapshot, err := svc.SmartFilmOrchestrationConfig(&stored)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Text["apiKey"] != "sk-private" || snapshot.Video["apiKey"] != "video-private" {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	modelOption, stageConfig, err := svc.smartFilmTextStageConfig(SmartFilmBatchConfig{DefaultTextModel: "fallback"}, &stored)
	if err != nil || modelOption != "text-model" || stageConfig["apiKey"] != "sk-private" || stageConfig["logicalModelId"] != "logical-text" {
		t.Fatalf("stage config = %q %+v, %v", modelOption, stageConfig, err)
	}
}

func TestSmartFilmBatchGroupsCharacterViewsByNameAndStoresSingleSkill(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	now := time.Now()
	first := model.Asset{ID: "character-a", UserID: "user-1", Kind: "image", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, Title: "人物图 A", CreatedAt: now, UpdatedAt: now}
	second := model.Asset{ID: "character-b", UserID: "user-1", Kind: "image", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, Title: "人物图 B", CreatedAt: now, UpdatedAt: now}
	for _, asset := range []*model.Asset{&first, &second} {
		if err := db.Create(asset).Error; err != nil {
			t.Fatal(err)
		}
	}
	request := CreateSmartFilmBatchRequest{
		Title: "人物名称", SourceText: "两个人物相遇", InputAssetIDs: []string{first.ID, second.ID},
		Config: SmartFilmBatchConfig{
			InputAssetRoles: map[string]string{first.ID: "character", second.ID: "character"},
			SkillSnapshot: &SmartFilmSkillSnapshot{
				SkillID: "skill-one", VersionID: "version-one", ContentHash: "hash-one", Name: "短剧导演", Version: "1",
				Stages: map[string]string{SmartFilmSkillStageScript: "剧本规范", SmartFilmSkillStageAssets: "资产规范", SmartFilmSkillStageStoryboard: "分镜规范", SmartFilmSkillStageImage: "图片规范", SmartFilmSkillStageVideo: "视频规范"},
			},
		},
	}
	if _, err := svc.CreateSmartFilmBatch("user-1", request); err == nil {
		t.Fatal("batch accepted character images without names")
	}
	request.Config.InputAssetNames = map[string]string{first.ID: "林默", second.ID: "林默"}
	created, err := svc.CreateSmartFilmBatch("user-1", request)
	if err != nil {
		t.Fatal(err)
	}
	if created.Config.InputAssetNames[first.ID] != "林默" || created.Config.InputAssetNames[second.ID] != "林默" {
		t.Fatalf("character names = %+v", created.Config.InputAssetNames)
	}
	if created.Config.SkillSnapshot == nil || created.Config.SkillSnapshot.SkillID != "skill-one" || len(created.Config.SkillSnapshot.Stages) != 5 {
		t.Fatalf("skill snapshot = %+v", created.Config.SkillSnapshot)
	}
	category, title := smartFilmInputAssetTitle(created.Config, first.ID)
	if category != model.AssetCategoryCharacter || title != "林默" {
		t.Fatalf("character asset link = %s/%s", category, title)
	}
	category, title = smartFilmInputAssetTitle(created.Config, second.ID)
	if category != model.AssetCategoryCharacter || title != "林默" {
		t.Fatalf("second character view link = %s/%s", category, title)
	}
	page, err := svc.ListSmartFilmBatches("user-1", "", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Batches) != 1 || page.Batches[0].Config.SkillSnapshot == nil || page.Batches[0].Config.SkillSnapshot.Name != "短剧导演" || len(page.Batches[0].Config.SkillSnapshot.Stages) != 0 {
		t.Fatalf("batch summary skill snapshot = %+v", page.Batches)
	}
}

func TestLinkProjectAssetUsesCharacterDisplayNameForAllViews(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "多视图角色", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, asset := range []model.Asset{
		{ID: "character-front", UserID: "user-1", Kind: "image", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, Title: "linmo-front", CreatedAt: now, UpdatedAt: now},
		{ID: "character-side", UserID: "user-1", Kind: "image", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, Title: "linmo-side", CreatedAt: now, UpdatedAt: now},
	} {
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := svc.LinkProjectAsset("user-1", project.ID, LinkProjectAssetRequest{
			AssetID: asset.ID, Category: string(model.AssetCategoryCharacter), Title: "林默", Source: AssetSourceUploaded,
		}); err != nil {
			t.Fatal(err)
		}
	}
	assets, err := svc.ProjectAssets("user-1", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(assets) != 2 {
		t.Fatalf("project assets = %d, want 2 character views", len(assets))
	}
	for _, asset := range assets {
		if asset.Category != model.AssetCategoryCharacter || asset.Title != "林默" {
			t.Fatalf("character view = %s/%s, want character/林默", asset.Category, asset.Title)
		}
	}
}

func TestSmartFilmBatchSkillCanChangeBeforeProjectAndLocksAfterward(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "更换技能", SourceText: "一个故事"})
	if err != nil {
		t.Fatal(err)
	}
	first := &SmartFilmSkillSnapshot{
		SkillID: "skill-one", VersionID: "version-one", ContentHash: "hash-one", Name: "技能一", Version: "1", RoutingMode: "auto",
		Stages: map[string]string{SmartFilmSkillStageScript: "剧本一", SmartFilmSkillStageAssets: "资产一", SmartFilmSkillStageStoryboard: "分镜一", SmartFilmSkillStageImage: "图片一", SmartFilmSkillStageVideo: "视频一"},
	}
	updated, err := svc.UpdateSmartFilmBatchSkill("user-1", created.ID, UpdateSmartFilmBatchSkillRequest{SkillSnapshot: first, ExpectedRevision: created.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Config.SkillSnapshot == nil || updated.Config.SkillSnapshot.SkillID != "skill-one" {
		t.Fatalf("updated skill = %+v", updated.Config.SkillSnapshot)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", updated.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: updated.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "剧本", Content: "正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	configureSmartFilmBatchFixed(t, svc, &saved, 1)
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	second := *first
	second.SkillID = "skill-two"
	second.Name = "技能二"
	if _, err := svc.UpdateSmartFilmBatchSkill("user-1", confirmed.ID, UpdateSmartFilmBatchSkillRequest{SkillSnapshot: &second, ExpectedRevision: confirmed.Revision}); err == nil {
		t.Fatal("skill changed after a project started production")
	}
}

func configureSmartFilmBatchFixed(t *testing.T, svc *Service, batch *SmartFilmBatchView, shotCount int) {
	t.Helper()
	if shotCount <= 0 {
		shotCount = 1
	}
	durations := make([]float64, shotCount)
	for index := range durations {
		durations[index] = 5
	}
	updated, err := svc.UpdateSmartFilmBatchProductionConfig("user-1", batch.ID, UpdateSmartFilmBatchProductionConfigRequest{
		ProductionMode: SmartFilmProductionModeFixed, ShotCount: shotCount,
		ShotDurationsSeconds: durations, ExpectedRevision: batch.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	*batch = updated
}

func TestSmartFilmBatchValidatesInputAssetsAndPerShotConfig(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	now := time.Now()
	ownedAsset := model.Asset{ID: "owned-product", UserID: "user-1", Kind: "image", Category: model.AssetCategoryProp, Status: model.AssetVersionStatusConfirmed, Title: "用户产品图", CreatedAt: now, UpdatedAt: now}
	foreignAsset := model.Asset{ID: "foreign-product", UserID: "user-2", Kind: "image", Category: model.AssetCategoryProp, Status: model.AssetVersionStatusConfirmed, Title: "他人产品图", CreatedAt: now, UpdatedAt: now}
	videoAsset := model.Asset{ID: "video-product", UserID: "user-1", Kind: "video", Category: model.AssetCategoryProp, Status: model.AssetVersionStatusConfirmed, Title: "视频素材", CreatedAt: now, UpdatedAt: now}
	for _, asset := range []*model.Asset{&ownedAsset, &foreignAsset, &videoAsset} {
		if err := db.Create(asset).Error; err != nil {
			t.Fatal(err)
		}
	}

	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{
		Title: "配置完整", SourceText: "产品短视频", InputAssetIDs: []string{ownedAsset.ID},
		Config: SmartFilmBatchConfig{
			AspectRatio: "16:9", StylePresetID: "", ScriptCount: 3, ShotCount: 2,
			DefaultVideoResolution: "480p", ShotDurationSeconds: 5, ShotDurationsSeconds: []float64{4, 7}, InputAssetRoles: map[string]string{ownedAsset.ID: "product"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Config.AspectRatio != "16:9" || created.Config.DefaultVideoResolution != "480p" || len(created.Config.ShotDurationsSeconds) != 2 || created.Config.ShotDurationsSeconds[1] != 7 || created.Config.InputAssetRoles[ownedAsset.ID] != "product" {
		t.Fatalf("created config = %+v", created.Config)
	}

	defaulted, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{
		Title: "默认逐镜", SourceText: "默认逐镜时长", Config: SmartFilmBatchConfig{ShotCount: 3, ShotDurationSeconds: 6},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(defaulted.Config.ShotDurationsSeconds) != 3 || defaulted.Config.ShotDurationsSeconds[2] != 6 {
		t.Fatalf("default durations = %+v", defaulted.Config.ShotDurationsSeconds)
	}

	cases := []struct {
		name string
		req  CreateSmartFilmBatchRequest
	}{
		{name: "foreign asset", req: CreateSmartFilmBatchRequest{Title: "越权", SourceText: "越权", InputAssetIDs: []string{foreignAsset.ID}}},
		{name: "non image", req: CreateSmartFilmBatchRequest{Title: "类型", SourceText: "类型", InputAssetIDs: []string{videoAsset.ID}}},
		{name: "aspect ratio", req: CreateSmartFilmBatchRequest{Title: "画幅", SourceText: "画幅", Config: SmartFilmBatchConfig{AspectRatio: "4:3"}}},
		{name: "duration count", req: CreateSmartFilmBatchRequest{Title: "时长", SourceText: "时长", Config: SmartFilmBatchConfig{ShotCount: 2, ShotDurationsSeconds: []float64{4}}}},
		{name: "asset role", req: CreateSmartFilmBatchRequest{Title: "类型", SourceText: "类型", InputAssetIDs: []string{ownedAsset.ID}, Config: SmartFilmBatchConfig{InputAssetRoles: map[string]string{ownedAsset.ID: "invalid"}}}},
	}
	for _, testCase := range cases {
		if _, err := svc.CreateSmartFilmBatch("user-1", testCase.req); err == nil {
			t.Fatalf("%s was accepted", testCase.name)
		}
	}
}

func TestSmartFilmBatchDefersShotStrategyUntilAfterScripts(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "先剧本后分镜", SourceText: "一个完整的产品故事"})
	if err != nil {
		t.Fatal(err)
	}
	if created.Config.ProductionMode != "" || created.Config.ShotCount != 0 {
		t.Fatalf("new batch unexpectedly fixed shot strategy: %+v", created.Config)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "候选剧本", Content: "完整剧本正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	}); err == nil {
		t.Fatal("confirm accepted a batch without shot strategy")
	}
	configured, err := svc.UpdateSmartFilmBatchProductionConfig("user-1", saved.ID, UpdateSmartFilmBatchProductionConfigRequest{
		ProductionMode: SmartFilmProductionModeSmart, TargetDurationSeconds: 30, ExpectedRevision: saved.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if configured.Config.ProductionMode != SmartFilmProductionModeSmart || configured.Config.TargetDurationSeconds != 30 || configured.Config.ShotCount != 0 {
		t.Fatalf("smart production config = %+v", configured.Config)
	}
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", configured.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: configured.Revision, ScriptIDs: []string{configured.Scripts[0].ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Scripts[0].ProjectID == "" {
		t.Fatal("configured smart batch did not create a project")
	}
}

func TestSmartFilmBatchPauseResumeSkipAndRecoveryTaskBehavior(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "控制", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "独立剧本", Content: "独立正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	configureSmartFilmBatchFixed(t, svc, &saved, 1)
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	runID := confirmed.ProductionRuns[0].ID
	initialAttempts := confirmed.ProductionRuns[0].Attempts
	paused, err := svc.ControlSmartFilmBatch("user-1", saved.ID, SmartFilmBatchControlRequest{Action: "pause"})
	if err != nil || !paused.Paused {
		t.Fatalf("pause batch = %+v, %v", paused, err)
	}
	if _, err := svc.StartSmartFilmProductionStage("user-1", saved.ID, runID, StartSmartFilmProductionStageRequest{Stage: SmartFilmProductionStepAssets}); err != nil {
		t.Fatal(err)
	}
	items, err := svc.SmartFilmAssetExtractionWorkItems(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("paused batch was claimed by worker: %+v", items)
	}
	resumed, err := svc.ControlSmartFilmBatch("user-1", saved.ID, SmartFilmBatchControlRequest{Action: "resume"})
	if err != nil || resumed.Paused {
		t.Fatalf("resume batch = %+v, %v", resumed, err)
	}
	items, err = svc.SmartFilmAssetExtractionWorkItems(10)
	if err != nil || len(items) != 1 {
		t.Fatalf("resumed work items = %+v, %v", items, err)
	}
	if _, err := svc.ControlSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionRunControlRequest{Action: "pause"}); err != nil {
		t.Fatal(err)
	}
	projectPaused, err := svc.ControlSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionRunControlRequest{Action: "resume"})
	if err != nil || projectPaused.ControlStatus != SmartFilmProductionControlActive {
		t.Fatalf("resume project = %+v, %v", projectPaused, err)
	}
	if err := db.Model(&model.SmartFilmProductionRun{}).Where("id = ?", runID).Updates(map[string]any{
		"status": SmartFilmProductionRunStatusNeedsAttention, "asset_status": SmartFilmProductionStageStatusAttention,
		"asset_task_id": "existing-task", "failed_step": SmartFilmProductionStepAssets,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "existing-task", UserID: "user-1", Type: "canvas_text", Status: model.TaskStatusFailed, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	retried, err := svc.ControlSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionRunControlRequest{Action: "retry", Stage: SmartFilmProductionStepAssets})
	if err != nil {
		t.Fatal(err)
	}
	if retried.AssetTaskID != "" || retried.AssetStatus != SmartFilmProductionStageStatusQueued || retried.Status != SmartFilmProductionRunStatusReady || retried.Attempts <= initialAttempts || retried.RetryReusedTask {
		t.Fatalf("retried run = %+v", retried)
	}
	if err := db.Create(&model.Task{ID: "reusable-storyboard", UserID: "user-1", Type: "canvas_text", Status: model.TaskStatusSucceeded, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SmartFilmProductionRun{}).Where("id = ?", runID).Updates(map[string]any{
		"status": SmartFilmProductionRunStatusNeedsAttention, "asset_status": SmartFilmProductionStageStatusConfirmed,
		"storyboard_status": SmartFilmProductionStageStatusAttention, "storyboard_task_id": "reusable-storyboard",
		"failed_step": SmartFilmProductionStepStoryboard,
	}).Error; err != nil {
		t.Fatal(err)
	}
	reused, err := svc.ControlSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionRunControlRequest{Action: "retry", Stage: SmartFilmProductionStepStoryboard})
	if err != nil {
		t.Fatal(err)
	}
	if reused.StoryboardTaskID != "reusable-storyboard" || reused.StoryboardStatus != SmartFilmProductionStageStatusQueued || reused.Attempts != retried.Attempts || !reused.RetryReusedTask {
		t.Fatalf("reused storyboard run = %+v", reused)
	}
	if err := db.Model(&model.SmartFilmProductionRun{}).Where("id = ?", runID).Updates(map[string]any{
		"status": SmartFilmProductionRunStatusNeedsAttention, "storyboard_status": SmartFilmProductionStageStatusAttention,
		"failed_step": SmartFilmProductionStepStoryboard,
	}).Error; err != nil {
		t.Fatal(err)
	}
	regenerated, err := svc.ControlSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionRunControlRequest{Action: "regenerate", Stage: SmartFilmProductionStepStoryboard})
	if err != nil {
		t.Fatal(err)
	}
	if regenerated.StoryboardTaskID != "" || regenerated.StoryboardStatus != SmartFilmProductionStageStatusQueued || regenerated.Attempts <= reused.Attempts || regenerated.RetryReusedTask {
		t.Fatalf("regenerated storyboard run = %+v", regenerated)
	}
	skipped, err := svc.ControlSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionRunControlRequest{Action: "skip"})
	if err != nil || skipped.ControlStatus != SmartFilmProductionControlSkipped || skipped.Status != SmartFilmProductionRunStatusSkipped {
		t.Fatalf("skipped run = %+v, %v", skipped, err)
	}
}

func TestSmartFilmBatchCreatesIndependentProjects(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	resource := model.Resource{
		ID: "resource-product", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		MimeType: "image/png", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{
		Title: "产品短视频批次", SourceText: "为同一款产品做三条互相独立的短视频", InputAssetIDs: []string{resource.ID}, Config: SmartFilmBatchConfig{
			ScriptCount: 3, ShotCount: 6, ShotDurationSeconds: 5, AspectRatio: "9:16",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 || len(created.Scripts) != 0 {
		t.Fatalf("unexpected created batch: %+v", created)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts: []SmartFilmScriptInput{
			{Title: "办公室", Content: "办公室里的独立视频剧本"},
			{Title: "露营", Content: "露营场景里的独立视频剧本"},
			{Title: "通勤", Content: "早晨通勤的独立视频剧本"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Scripts) != 3 {
		t.Fatalf("scripts = %d, want 3", len(saved.Scripts))
	}
	selected := []string{saved.Scripts[0].ID, saved.Scripts[2].ID}
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: selected,
	})
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Scripts[0].ProjectID == "" || confirmed.Scripts[2].ProjectID == "" {
		t.Fatalf("selected scripts did not get projects: %+v", confirmed.Scripts)
	}
	if confirmed.Scripts[1].ProjectID != "" {
		t.Fatalf("unselected script received a project: %+v", confirmed.Scripts[1])
	}
	if confirmed.Scripts[0].ProjectID == confirmed.Scripts[2].ProjectID {
		t.Fatal("independent scripts shared one project")
	}
	var projects []model.Project
	if err := db.Where("user_id = ? AND type = ?", "user-1", "smart-film").Find(&projects).Error; err != nil {
		t.Fatal(err)
	}
	if len(projects) != 2 {
		t.Fatalf("projects = %d, want 2", len(projects))
	}
	for _, script := range []SmartFilmScript{confirmed.Scripts[0], confirmed.Scripts[2]} {
		var unit model.ProjectUnit
		if err := db.Where("id = ? AND project_id = ?", script.UnitID, script.ProjectID).First(&unit).Error; err != nil {
			t.Fatal(err)
		}
		if unit.SourceText != script.Content {
			t.Fatalf("unit source = %q, want %q", unit.SourceText, script.Content)
		}
		var project model.Project
		if err := db.First(&project, "id = ?", script.ProjectID).Error; err != nil {
			t.Fatal(err)
		}
		if project.BatchID != confirmed.ID || project.SourceScriptID != script.ID || project.SourceRunID == "" {
			t.Fatalf("project source fields = %+v", project)
		}
	}
	if len(confirmed.ProductionRuns) != 2 {
		t.Fatalf("production runs = %d, want 2", len(confirmed.ProductionRuns))
	}
	for _, run := range confirmed.ProductionRuns {
		if run.Status != SmartFilmProductionRunStatusReady || run.Resources.ProjectID == "" || run.Resources.UnitID == "" {
			t.Fatalf("run was not finalized: %+v", run)
		}
	}

	replayed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: selected,
	})
	if err != nil {
		t.Fatalf("idempotent retry failed: %v", err)
	}
	var replayProjectCount int64
	if err := db.Model(&model.Project{}).Where("user_id = ? AND type = ?", "user-1", "smart-film").Count(&replayProjectCount).Error; err != nil {
		t.Fatal(err)
	}
	if replayProjectCount != 2 || replayed.Scripts[0].ProjectID != confirmed.Scripts[0].ProjectID {
		t.Fatalf("retry created duplicate resources: %+v", replayed.Scripts)
	}
	var assetLinks int64
	if err := db.Model(&model.ProjectAssetLink{}).Where("project_id IN ?", []string{confirmed.Scripts[0].ProjectID, confirmed.Scripts[2].ProjectID}).Count(&assetLinks).Error; err != nil {
		t.Fatal(err)
	}
	if assetLinks != 2 {
		t.Fatalf("product asset links = %d, want 2", assetLinks)
	}
}

func TestSmartFilmBatchListFiltersAndDeletePreservesProjects(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	draft, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "草稿批次", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveSmartFilmBatchScripts("user-1", draft.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: draft.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "草稿剧本", Content: "内容"}},
	}); err != nil {
		t.Fatal(err)
	}
	confirmed, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "已确认批次", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", confirmed.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: confirmed.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "确认剧本", Content: "内容"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	configureSmartFilmBatchFixed(t, svc, &saved, 1)
	if _, err := svc.ConfirmSmartFilmBatchScripts("user-1", confirmed.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	}); err != nil {
		t.Fatal(err)
	}
	project := seedProject(t, db, model.Project{ID: "batch-project", UserID: "user-1", Name: "批次项目"})
	if err := db.Model(&model.Project{}).Where("id = ?", project.ID).Updates(map[string]any{"batch_id": confirmed.ID, "source_script_id": saved.Scripts[0].ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SmartFilmScriptRecord{}).Where("id = ?", saved.Scripts[0].ID).Update("project_id", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	activeTask := model.Task{ID: "batch-project-task", UserID: "user-1", ProjectID: project.ID, Type: "canvas_video", Status: model.TaskStatusRunning, Attempts: 1}
	if err := db.Create(&activeTask).Error; err != nil {
		t.Fatal(err)
	}
	page, err := svc.ListSmartFilmBatches("user-1", SmartFilmScriptStatusDraft, 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Batches) != 1 || page.Batches[0].ID != draft.ID {
		t.Fatalf("draft batch list = %+v", page)
	}
	if err := svc.DeleteSmartFilmBatch("user-1", confirmed.ID); err == nil {
		t.Fatal("batch with an active project task was deleted")
	}
	if err := db.Delete(&activeTask).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteSmartFilmBatch("user-1", confirmed.ID); err != nil {
		t.Fatal(err)
	}
	var retainedProject model.Project
	if err := db.First(&retainedProject, "id = ?", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if retainedProject.BatchID != "" || retainedProject.SourceScriptID != "" {
		t.Fatalf("project batch link was not cleared: %+v", retainedProject)
	}
	if err := svc.DeleteSmartFilmBatch("user-1", draft.ID); err != nil {
		t.Fatal(err)
	}
	page, err = svc.ListSmartFilmBatches("user-1", "", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 {
		t.Fatalf("batch list after delete = %+v", page)
	}
}

func TestSmartFilmBatchCostUsesServerQuotesAndBudget(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	svc.quoteTask = func(_ string, req localtask.CreateRequest) (*billing.BillingQuote, error) {
		if req.Type == "canvas_video" {
			return &billing.BillingQuote{Enabled: true, Points: 10, Balance: 120}, nil
		}
		return &billing.BillingQuote{Enabled: true, Points: 3, Balance: 100}, nil
	}
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "预算批次", SourceText: "想法", BudgetPoints: 100, Config: SmartFilmBatchConfig{ShotCount: 2, ShotDurationSeconds: 5, DefaultTextModel: "text-model", DefaultVideoModel: "video-model"}})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{ExpectedRevision: created.Revision, Scripts: []SmartFilmScriptInput{{Title: "剧本", Content: "内容"}}})
	if err != nil {
		t.Fatal(err)
	}
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID}})
	if err != nil {
		t.Fatal(err)
	}
	projectID := confirmed.Scripts[0].ProjectID
	if err := db.Create(&model.Task{ID: "budget-task", UserID: "user-1", ProjectID: projectID, Type: "canvas_text", Status: model.TaskStatusSucceeded}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE tasks SET billing_points = 5, billing_status = 'reserved' WHERE id = 'budget-task'").Error; err != nil {
		t.Fatal(err)
	}
	costs, err := svc.SmartFilmBatchCost("user-1", saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if costs.CommittedPoints != 5 || costs.EstimatedPoints != 23 || costs.TotalPoints != 28 || costs.OverBudget {
		t.Fatalf("costs = %+v", costs)
	}
	updated, err := svc.UpdateSmartFilmBatchBudget("user-1", saved.ID, UpdateSmartFilmBatchBudgetRequest{BudgetPoints: 20})
	if err != nil || updated.BudgetPoints != 20 {
		t.Fatalf("updated budget = %+v, %v", updated, err)
	}
	costs, err = svc.SmartFilmBatchCost("user-1", saved.ID)
	if err != nil || !costs.OverBudget || costs.Balance != 100 {
		t.Fatalf("over-budget costs = %+v, %v", costs, err)
	}
}

func TestSmartFilmBatchRejectsRevisionConflict(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "冲突", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision + 1,
		Scripts:          []SmartFilmScriptInput{{Title: "剧本", Content: "正文"}},
	}); err == nil {
		t.Fatal("stale batch revision was accepted")
	}
}

func TestSmartFilmBatchConfirmRejectsStaleRevisionBeforeCreatingProjects(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "并发确认", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "独立剧本", Content: "独立正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	configureSmartFilmBatchFixed(t, svc, &saved, 1)
	if _, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision + 1,
		ScriptIDs:        []string{saved.Scripts[0].ID},
	}); err == nil {
		t.Fatal("stale confirm revision was accepted")
	}
	var count int64
	if err := db.Model(&model.Project{}).Where("user_id = ?", "user-1").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("stale confirm created %d projects", count)
	}
}

func TestSmartFilmBatchConfirmRollsBackAllResourcesAndLeavesRecoverableRun(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	resource := model.Resource{ID: "missing-asset", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{
		Title: "失败恢复", SourceText: "产品短片", InputAssetIDs: []string{"missing-asset"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&model.Resource{}, "id = ?", resource.ID).Error; err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "独立剧本", Content: "独立正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	configureSmartFilmBatchFixed(t, svc, &saved, 1)
	if _, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	}); err == nil {
		t.Fatal("confirm with a missing product asset succeeded")
	}

	var projects int64
	if err := db.Model(&model.Project{}).Where("user_id = ?", "user-1").Count(&projects).Error; err != nil {
		t.Fatal(err)
	}
	if projects != 0 {
		t.Fatalf("failed confirm left %d projects behind", projects)
	}
	var units int64
	if err := db.Model(&model.ProjectUnit{}).Count(&units).Error; err != nil {
		t.Fatal(err)
	}
	if units != 0 {
		t.Fatalf("failed confirm left %d units behind", units)
	}
	var run model.SmartFilmProductionRun
	if err := db.Where("batch_id = ?", saved.ID).First(&run).Error; err != nil {
		t.Fatal(err)
	}
	if run.Status != SmartFilmProductionRunStatusNeedsAttention || run.FailedStep != SmartFilmProductionStepAssetLink || run.RecoverableAction != SmartFilmProductionActionRetry {
		t.Fatalf("recoverable run = %+v", run)
	}
}

func TestSmartFilmBatchConfirmRecoversProjectWithoutUnit(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "孤儿项目", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "独立剧本", Content: "独立正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "已有项目", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	partial := saved.Scripts
	partial[0].ProjectID = project.ID
	partial[0].Status = SmartFilmScriptStatusNeedsAttention
	partial[0].Error = "项目已创建，但章节创建失败"
	configureSmartFilmBatchFixed(t, svc, &saved, 1)
	if err := db.Model(&model.SmartFilmBatch{}).Where("id = ?", saved.ID).Updates(map[string]any{
		"revision": saved.Revision + 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SmartFilmScriptRecord{}).Where("id = ?", partial[0].ID).Updates(map[string]any{
		"project_id": project.ID, "status": SmartFilmScriptStatusNeedsAttention,
		"error": "项目已创建，但章节创建失败", "revision": gorm.Expr("revision + 1"),
	}).Error; err != nil {
		t.Fatal(err)
	}
	recovered, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision + 1, ScriptIDs: []string{partial[0].ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Scripts[0].ProjectID != project.ID || recovered.Scripts[0].UnitID == "" {
		t.Fatalf("orphan project was not recovered: %+v", recovered.Scripts[0])
	}
	var projectCount, unitCount int64
	if err := db.Model(&model.Project{}).Where("user_id = ?", "user-1").Count(&projectCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ProjectUnit{}).Where("project_id = ?", project.ID).Count(&unitCount).Error; err != nil {
		t.Fatal(err)
	}
	if projectCount != 1 || unitCount != 1 {
		t.Fatalf("recovery created projects=%d units=%d", projectCount, unitCount)
	}
	if len(recovered.ProductionRuns) != 1 || recovered.ProductionRuns[0].Status != SmartFilmProductionRunStatusReady {
		t.Fatalf("recovery run = %+v", recovered.ProductionRuns)
	}
}

func TestSmartFilmAssetBindingResetsConfirmedPrompt(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "资产变更", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "独立视频", SourceText: "剧本"})
	if err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-product", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		MimeType: "image/png", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	linked, err := svc.LinkProjectAsset("user-1", project.ID, LinkProjectAssetRequest{
		AssetID: resource.ID, Category: string(model.AssetCategoryProp), Source: AssetSourceUploaded, Title: "产品图",
	})
	if err != nil {
		t.Fatal(err)
	}
	shot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		UnitID: unit.ID, Title: "镜头 1", Position: 0, DurationMs: 3000, Status: "confirmed",
		Revision: ShotRevisionInput{PlotDescription: "产品出现在画面中央", DurationMs: 3000},
	})
	if err != nil {
		t.Fatal(err)
	}
	reference, err := svc.LinkShotAsset("user-1", project.ID, shot.ID, LinkShotAssetRequest{
		AssetVersionID: linked.PrimaryVersionID, Role: "reference",
	})
	if err != nil {
		t.Fatal(err)
	}
	assertShotStatus := func(want string) {
		t.Helper()
		var stored model.Shot
		if err := db.First(&stored, "id = ?", shot.ID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.Status != want {
			t.Fatalf("shot status = %q, want %q", stored.Status, want)
		}
	}
	assertShotStatus("draft")
	if _, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		ID: shot.ID, UnitID: unit.ID, Title: shot.Title, Position: shot.Position, DurationMs: 3000, Status: "confirmed",
		Revision: ShotRevisionInput{PlotDescription: "产品出现在画面中央", DurationMs: 3000},
	}); err != nil {
		t.Fatal(err)
	}
	assertShotStatus("confirmed")
	if err := svc.UnlinkShotAsset("user-1", project.ID, shot.ID, reference.ID); err != nil {
		t.Fatal(err)
	}
	assertShotStatus("draft")
	if _, err := svc.LinkShotAsset("user-1", project.ID, shot.ID, LinkShotAssetRequest{
		AssetVersionID: linked.PrimaryVersionID, Role: "reference",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		ID: shot.ID, UnitID: unit.ID, Title: shot.Title, Position: shot.Position, DurationMs: 3000, Status: "confirmed",
		Revision: ShotRevisionInput{PlotDescription: "确认旧产品图", DurationMs: 3000},
	}); err != nil {
		t.Fatal(err)
	}
	assertShotStatus("confirmed")
	if _, err := svc.CreateProjectAssetVersion("user-1", project.ID, linked.ID, CreateAssetVersionRequest{
		DefinitionJSON: `{"prompt":"替换后的产品图"}`,
	}); err != nil {
		t.Fatal(err)
	}
	assertShotStatus("draft")
	if err := svc.EnsureSmartFilmVideoTaskAllowed("user-1", project.ID, map[string]any{
		"mode": "video", "metadata": map[string]any{"shotId": shot.ID},
	}); err == nil {
		t.Fatal("video task was allowed after asset version replacement")
	}
}

func TestTextOnlyProjectAssetCannotBeLinkedAsShotReference(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "文本资产门禁", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "独立视频", SourceText: "剧本"})
	if err != nil {
		t.Fatal(err)
	}
	shot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		UnitID: unit.ID, Title: "镜头 1", Position: 0, DurationMs: 3000,
		Revision: ShotRevisionInput{PlotDescription: "角色推门进入房间", DurationMs: 3000},
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	asset := model.Asset{
		ID: "text-setting", UserID: "user-1", Kind: "text", Category: model.AssetCategoryProp,
		Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "text-setting-v1", Title: "门窗设定",
		PayloadJSON: `{}`, CreatedAt: now, UpdatedAt: now,
	}
	version := model.AssetVersion{
		ID: asset.PrimaryVersionID, AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed,
		DefinitionJSON: `{"description":"木质推拉门"}`, CreatedAt: now, UpdatedAt: now,
	}
	link := model.ProjectAssetLink{ID: "text-setting-link", ProjectID: project.ID, AssetID: asset.ID, Position: 0, CreatedAt: now}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&version).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&link).Error; err != nil {
		t.Fatal(err)
	}
	_, err = svc.LinkShotAsset("user-1", project.ID, shot.ID, LinkShotAssetRequest{AssetVersionID: version.ID, Role: "reference"})
	if err == nil || !strings.Contains(err.Error(), "文本设定") {
		t.Fatalf("LinkShotAsset error = %v, want text-only rejection", err)
	}
}

func TestPromoteTextAssetToVisualCreatesImageVersionAndInvalidatesShots(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "文本升级", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "独立视频", SourceText: "剧本"})
	if err != nil {
		t.Fatal(err)
	}
	shot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		UnitID: unit.ID, Title: "镜头 1", Position: 0, DurationMs: 3000, Status: "confirmed",
		Revision: ShotRevisionInput{PlotDescription: "桌上放着咖啡杯", DurationMs: 3000},
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	asset := model.Asset{
		ID: "text-cup", UserID: "user-1", Kind: "text", Category: model.AssetCategoryProp,
		Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "text-cup-v1", Title: "咖啡杯",
		PayloadJSON: `{"data":{"content":"白色陶瓷咖啡杯"}}`, CreatedAt: now, UpdatedAt: now,
	}
	version := model.AssetVersion{ID: asset.PrimaryVersionID, AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"description":"白色陶瓷咖啡杯"}`, CreatedAt: now, UpdatedAt: now}
	link := model.ProjectAssetLink{ID: "text-cup-link", ProjectID: project.ID, AssetID: asset.ID, Position: 0, CreatedAt: now}
	reference := model.ShotAssetReference{ID: "text-cup-reference", ShotID: shot.ID, AssetVersionID: version.ID, Role: "reference", Status: "linked", CreatedAt: now}
	artifact := model.ShotArtifact{ID: "text-cup-artifact", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Type: "storyboard", Version: 1, ResourceID: "resource-storyboard", Status: "ready", Selected: true, CreatedAt: now, UpdatedAt: now}
	image := model.Resource{ID: "resource-cup-image", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Width: 1024, Height: 1024, CreatedAt: now, UpdatedAt: now}
	for _, item := range []any{&asset, &version, &link, &reference, &artifact, &image} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	latestProject, err := svc.Owned("user-1", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	wholeFilm := model.ProjectUnitArtifact{
		ID: "whole-film-stale-after-asset", ProjectID: project.ID, UnitID: unit.ID, TaskID: "task-whole-film",
		Type: "smart_film", Version: 1, ResourceID: "resource-whole-film", Status: "ready", Selected: true,
	}
	if err := db.Create(&wholeFilm).Error; err != nil {
		t.Fatal(err)
	}
	promoted, err := svc.PromoteProjectAssetVisual("user-1", project.ID, asset.ID, PromoteProjectAssetVisualRequest{
		ResourceID: image.ID, TaskID: "task-promote-cup", Model: "image-model", Prompt: "白色陶瓷咖啡杯，干净背景", ExpectedRevision: latestProject.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if promoted.MediaType != "image" || promoted.PrimaryVersionID == version.ID || promoted.StorageKey != "resource:"+image.ID {
		t.Fatalf("promoted asset = %+v", promoted)
	}
	var versions []model.AssetVersion
	if err := db.Where("asset_id = ?", asset.ID).Order("version asc").Find(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 || versions[0].ID != version.ID || versions[1].Status != model.AssetVersionStatusConfirmed {
		t.Fatalf("versions = %+v", versions)
	}
	var representation model.AssetRepresentation
	if err := db.First(&representation, "asset_version_id = ? AND resource_id = ?", versions[1].ID, image.ID).Error; err != nil {
		t.Fatal(err)
	}
	var storedShot model.Shot
	if err := db.First(&storedShot, "id = ?", shot.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedShot.Status != "draft" {
		t.Fatalf("shot status = %q, want draft", storedShot.Status)
	}
	var storedArtifact model.ShotArtifact
	if err := db.First(&storedArtifact, "id = ?", artifact.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedArtifact.Status != "stale" || storedArtifact.Selected {
		t.Fatalf("artifact = %+v, want stale and unselected", storedArtifact)
	}
	var storedWholeFilm model.ProjectUnitArtifact
	if err := db.First(&storedWholeFilm, "id = ?", wholeFilm.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedWholeFilm.Status != "stale" || storedWholeFilm.Selected {
		t.Fatalf("whole film artifact = %+v, want stale and unselected", storedWholeFilm)
	}
}

func TestSelectShotArtifactOnlyUsesCurrentReadyRevision(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "产物版本", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "独立视频", SourceText: "剧本"})
	if err != nil {
		t.Fatal(err)
	}
	shot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		UnitID: unit.ID, Title: "镜头 1", Position: 0, DurationMs: 3000,
		Revision: ShotRevisionInput{PlotDescription: "人物抬头", DurationMs: 3000},
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	artifacts := []model.ShotArtifact{
		{ID: "old-ready", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: "old-revision", Type: "video", Version: 1, ResourceID: "resource-old", Status: "ready", Selected: true, CreatedAt: now, UpdatedAt: now},
		{ID: "current-ready", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Type: "video", Version: 2, ResourceID: "resource-current", Status: "ready", CreatedAt: now, UpdatedAt: now},
		{ID: "current-stale", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Type: "video", Version: 3, ResourceID: "resource-stale", Status: "stale", CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&artifacts).Error; err != nil {
		t.Fatal(err)
	}
	selected, err := svc.SelectShotArtifact("user-1", project.ID, shot.ID, "current-ready")
	if err != nil {
		t.Fatal(err)
	}
	if !selected.Selected {
		t.Fatalf("selected artifact = %+v", selected)
	}
	var stored []model.ShotArtifact
	if err := db.Where("shot_id = ? AND type = ?", shot.ID, "video").Order("version asc").Find(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored[0].Selected || !stored[1].Selected || stored[2].Selected {
		t.Fatalf("artifact selection = %+v", stored)
	}
	if _, err := svc.SelectShotArtifact("user-1", project.ID, shot.ID, "old-ready"); err == nil || !strings.Contains(err.Error(), "历史镜头版本") {
		t.Fatalf("old artifact error = %v", err)
	}
	if _, err := svc.SelectShotArtifact("user-1", project.ID, shot.ID, "current-stale"); err == nil || !strings.Contains(err.Error(), "已生成") {
		t.Fatalf("stale artifact error = %v", err)
	}
}

func TestReviewProjectShotBindsRevisionAndResetsWhenContentChanges(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "镜头审核", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "独立视频", SourceText: "剧本"})
	if err != nil {
		t.Fatal(err)
	}
	shot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		UnitID: unit.ID, Title: "镜头 1", Position: 0, DurationMs: 3000,
		Revision: ShotRevisionInput{PlotDescription: "人物抬头", DurationMs: 3000},
	})
	if err != nil {
		t.Fatal(err)
	}
	approved, err := svc.ReviewProjectShot("user-1", project.ID, shot.ID, ReviewProjectShotRequest{Status: "approved", ExpectedRevisionID: shot.CurrentRevisionID})
	if err != nil {
		t.Fatal(err)
	}
	if approved.ReviewStatus != "approved" || approved.ReviewRevisionID != shot.CurrentRevisionID || approved.ReviewedAt == nil {
		t.Fatalf("approved shot = %+v", approved)
	}
	now := time.Now()
	if err := svc.repo.CreateShotArtifact(&model.ShotArtifact{
		ID: "review-artifact", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID,
		Type: "storyboard", ResourceID: "review-resource", Status: "ready", Selected: true, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	var afterArtifact model.Shot
	if err := db.First(&afterArtifact, "id = ?", shot.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterArtifact.ReviewStatus != "pending" || afterArtifact.ReviewNote != "" || afterArtifact.ReviewedAt != nil {
		t.Fatalf("review after artifact = %+v", afterArtifact)
	}
	if _, err := svc.ReviewProjectShot("user-1", project.ID, shot.ID, ReviewProjectShotRequest{Status: "rejected", ExpectedRevisionID: shot.CurrentRevisionID}); err == nil || !strings.Contains(err.Error(), "修改意见") {
		t.Fatalf("reject without note error = %v", err)
	}
	rejected, err := svc.ReviewProjectShot("user-1", project.ID, shot.ID, ReviewProjectShotRequest{Status: "rejected", Note: "人物手部位置不对", ExpectedRevisionID: shot.CurrentRevisionID})
	if err != nil {
		t.Fatal(err)
	}
	if rejected.ReviewStatus != "rejected" || rejected.ReviewNote != "人物手部位置不对" {
		t.Fatalf("rejected shot = %+v", rejected)
	}
	saved, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		ID: shot.ID, UnitID: unit.ID, Title: shot.Title, Position: shot.Position, DurationMs: 3000,
		Revision: ShotRevisionInput{PlotDescription: "人物抬头并看向镜头", DurationMs: 3000},
	})
	if err != nil {
		t.Fatal(err)
	}
	var afterRevision model.Shot
	if err := db.First(&afterRevision, "id = ?", saved.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterRevision.ReviewStatus != "pending" || afterRevision.ReviewNote != "" || afterRevision.ReviewRevisionID != "" || afterRevision.ReviewedAt != nil {
		t.Fatalf("review after revision = %+v", afterRevision)
	}
}

func TestSmartFilmProductionRunCheckpointsAssetAndStoryboardStages(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "阶段记录", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "独立剧本", Content: "独立正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	configureSmartFilmBatchFixed(t, svc, &saved, 1)
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(confirmed.ProductionRuns) != 1 || confirmed.ProductionRuns[0].AssetStatus != SmartFilmProductionStageStatusWaiting {
		t.Fatalf("initial run = %+v", confirmed.ProductionRuns)
	}
	runID := confirmed.ProductionRuns[0].ID
	runningAssets, err := svc.CheckpointSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionStageCheckpointRequest{
		Stage: SmartFilmProductionStepAssets, Status: SmartFilmProductionStageStatusRunning,
	})
	if err != nil {
		t.Fatal(err)
	}
	if runningAssets.AssetStatus != SmartFilmProductionStageStatusRunning || runningAssets.CurrentStep != SmartFilmProductionStepAssets {
		t.Fatalf("running assets = %+v", runningAssets)
	}
	readyAssets, err := svc.CheckpointSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionStageCheckpointRequest{
		Stage: SmartFilmProductionStepAssets, Status: SmartFilmProductionStageStatusReady, TaskID: "asset-task", ResourceCount: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if readyAssets.AssetStatus != SmartFilmProductionStageStatusReady || readyAssets.AssetTaskID != "asset-task" || readyAssets.AssetCount != 3 || readyAssets.Revision <= runningAssets.Revision {
		t.Fatalf("ready assets = %+v", readyAssets)
	}
	failedStoryboard, err := svc.CheckpointSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionStageCheckpointRequest{
		Stage: SmartFilmProductionStepStoryboard, Status: SmartFilmProductionStageStatusAttention, TaskID: "storyboard-task", Error: "模型输出无效",
	})
	if err != nil {
		t.Fatal(err)
	}
	if failedStoryboard.StoryboardStatus != SmartFilmProductionStageStatusAttention || failedStoryboard.RecoverableAction != SmartFilmProductionActionRetryStoryboard || failedStoryboard.Error != "模型输出无效" {
		t.Fatalf("failed storyboard = %+v", failedStoryboard)
	}
	readyStoryboard, err := svc.CheckpointSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionStageCheckpointRequest{
		Stage: SmartFilmProductionStepStoryboard, Status: SmartFilmProductionStageStatusReady, TaskID: "storyboard-task", ResourceCount: 6,
	})
	if err != nil {
		t.Fatal(err)
	}
	if readyStoryboard.StoryboardStatus != SmartFilmProductionStageStatusReady || readyStoryboard.StoryboardShotCount != 6 || readyStoryboard.Error != "" || readyStoryboard.RecoverableAction != "" {
		t.Fatalf("ready storyboard = %+v", readyStoryboard)
	}
}

func TestSmartFilmAssetConfirmationQueuesStoryboardPrompts(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	now := time.Now()
	run := model.SmartFilmProductionRun{
		ID: "asset-confirm-run", UserID: "user-1", BatchID: "asset-confirm-batch", ScriptID: "asset-confirm-script",
		IdempotencyKey: "asset-confirm-key", Status: SmartFilmProductionRunStatusReady, CurrentStep: SmartFilmProductionStepAssets,
		ProjectID: "asset-confirm-project", UnitID: "asset-confirm-unit",
		AssetStatus: SmartFilmProductionStageStatusReady, StoryboardStatus: SmartFilmProductionStageStatusWaiting,
		ControlStatus: SmartFilmProductionControlActive, Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.MarkSmartFilmAssetStageConfirmed(run.ProjectID, run.UnitID); err != nil {
		t.Fatal(err)
	}
	var queued model.SmartFilmProductionRun
	if err := db.First(&queued, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if queued.AssetStatus != SmartFilmProductionStageStatusConfirmed || queued.StoryboardStatus != SmartFilmProductionStageStatusQueued || queued.CurrentStep != SmartFilmProductionStepStoryboard || queued.Status != SmartFilmProductionRunStatusReady {
		t.Fatalf("asset confirmation did not queue storyboard prompts: %+v", queued)
	}
	projectRun, err := svc.SmartFilmProductionRunForProject(run.UserID, run.ProjectID)
	if err != nil || projectRun.ID != run.ID || projectRun.AssetStatus != SmartFilmProductionStageStatusConfirmed {
		t.Fatalf("project run lookup = %+v, %v", projectRun, err)
	}

	if err := db.Model(&model.SmartFilmProductionRun{}).Where("id = ?", run.ID).Update("storyboard_status", SmartFilmProductionStageStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.MarkSmartFilmAssetStageConfirmed(run.ProjectID, run.UnitID); err != nil {
		t.Fatal(err)
	}
	var stillRunning model.SmartFilmProductionRun
	if err := db.First(&stillRunning, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stillRunning.StoryboardStatus != SmartFilmProductionStageStatusRunning {
		t.Fatalf("repeated asset confirmation reset a running storyboard: %+v", stillRunning)
	}

	noMissingRun := model.SmartFilmProductionRun{
		ID: "no-missing-run", UserID: "user-1", BatchID: "no-missing-batch", ScriptID: "no-missing-script",
		IdempotencyKey: "no-missing-key", Status: SmartFilmProductionRunStatusReady, CurrentStep: SmartFilmProductionStepAssets,
		ProjectID: "no-missing-project", UnitID: "no-missing-unit",
		AssetStatus: SmartFilmProductionStageStatusReady, StoryboardStatus: SmartFilmProductionStageStatusWaiting,
		ControlStatus: SmartFilmProductionControlActive, Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&noMissingRun).Error; err != nil {
		t.Fatal(err)
	}
	checkpointed, err := svc.CheckpointSmartFilmProductionRun("user-1", noMissingRun.BatchID, noMissingRun.ID, SmartFilmProductionStageCheckpointRequest{
		Stage: SmartFilmProductionStepAssets, Status: SmartFilmProductionStageStatusConfirmed,
	})
	if err != nil {
		t.Fatal(err)
	}
	if checkpointed.AssetStatus != SmartFilmProductionStageStatusConfirmed || checkpointed.StoryboardStatus != SmartFilmProductionStageStatusQueued || checkpointed.CurrentStep != SmartFilmProductionStepStoryboard {
		t.Fatalf("asset checkpoint without missing assets did not queue storyboard: %+v", checkpointed)
	}
}

func TestSmartFilmStoryboardUsesPendingAssetPromptsAsTextSettings(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "提示词资产", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "第一场", SourceText: "沉船训练场里的追逐"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	candidates, err := svc.CreateProjectAssetCandidates("user-1", project.ID, CreateAssetCandidatesRequest{
		Source: AssetCandidateSourceChapterCharacter,
		Candidates: []AssetCandidateInput{{
			UnitID: unit.ID, Name: "沉船训练场", Category: string(model.AssetCategoryEnvironment),
			Details: map[string]any{"prompt": "幽暗沉船训练场，蓝绿色海水与破损金属舱门"},
		}, {
			UnitID: unit.ID, Name: "备用电池", Category: string(model.AssetCategoryProp),
			Details: map[string]any{"prompt": "带蓝色指示灯的备用电池"},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 {
		t.Fatalf("candidates = %+v", candidates)
	}
	candidate := candidates[0]
	assets, err := svc.smartFilmStoryboardAssets("user-1", project.ID, unit.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(assets) != 2 || assets[0].Title != candidate.Name || assets[0].VisualReference || assets[0].MediaType != "text" {
		t.Fatalf("prompt-only storyboard assets = %+v", assets)
	}
	if !strings.Contains(assets[0].Prompt, "幽暗沉船训练场") {
		t.Fatalf("prompt-only asset lost its prompt: %+v", assets[0])
	}
	confirmedOnly, err := svc.smartFilmStoryboardAssets("user-1", project.ID, unit.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(confirmedOnly) != 0 {
		t.Fatalf("asset extraction context should not include pending candidates: %+v", confirmedOnly)
	}
	confirmedAsset, err := svc.ConfirmProjectAssetCandidate("user-1", project.ID, candidates[1].ID, ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	version, err := svc.repo.AssetVersion(confirmedAsset.PrimaryVersionID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(version.Prompt, "蓝色指示灯") {
		t.Fatalf("text-only confirmation lost candidate prompt: %+v", version)
	}
	textAssets, err := svc.smartFilmStoryboardAssets("user-1", project.ID, unit.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(textAssets) != 1 || textAssets[0].VisualReference || !strings.Contains(textAssets[0].Prompt, "蓝色指示灯") {
		t.Fatalf("confirmed text-only storyboard asset = %+v", textAssets)
	}

	run := model.SmartFilmProductionRun{
		ID: "prompt-only-run", UserID: "user-1", BatchID: "prompt-only-batch", ScriptID: "prompt-only-script",
		IdempotencyKey: "prompt-only-key", Status: SmartFilmProductionRunStatusReady, CurrentStep: SmartFilmProductionStepAssets,
		ProjectID: project.ID, UnitID: unit.ID,
		AssetStatus: SmartFilmProductionStageStatusReady, StoryboardStatus: SmartFilmProductionStageStatusWaiting,
		ControlStatus: SmartFilmProductionControlActive, Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	started, err := svc.StartSmartFilmProductionStage("user-1", run.BatchID, run.ID, StartSmartFilmProductionStageRequest{Stage: SmartFilmProductionStepStoryboard})
	if err != nil {
		t.Fatal(err)
	}
	if started.StoryboardStatus != SmartFilmProductionStageStatusQueued {
		t.Fatalf("storyboard was still blocked by a prompt-only candidate: %+v", started)
	}
}

func TestSmartFilmScriptDeleteRemovesOrphanProductionRun(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "孤立运行", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "待删除剧本", Content: "待删除正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	scriptID := saved.Scripts[0].ID
	run := model.SmartFilmProductionRun{
		ID: kernel.NewID(), UserID: "user-1", BatchID: saved.ID, ScriptID: scriptID,
		IdempotencyKey: kernel.NewID(), Status: SmartFilmProductionRunStatusNeedsAttention,
		CurrentStep: SmartFilmProductionStepProject, FailedStep: SmartFilmProductionStepProject,
		ControlStatus: SmartFilmProductionControlActive, Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DeleteSmartFilmBatchScript("user-1", saved.ID, scriptID, saved.Revision); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.SmartFilmProductionRun{}).Where("id = ?", run.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("orphan production run survived script deletion: %d", count)
	}
}

func TestSmartFilmScriptRegenerationArchivesOldUnprojectedRun(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "重新生成", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "旧剧本", Content: "旧正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	scriptID := saved.Scripts[0].ID
	run := model.SmartFilmProductionRun{
		ID: kernel.NewID(), UserID: "user-1", BatchID: saved.ID, ScriptID: scriptID,
		IdempotencyKey: kernel.NewID(), Status: SmartFilmProductionRunStatusNeedsAttention,
		CurrentStep: SmartFilmProductionStepProject, FailedStep: SmartFilmProductionStepProject,
		ControlStatus: SmartFilmProductionControlActive, Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateSmartFilmBatchScript("user-1", saved.ID, scriptID, UpdateSmartFilmBatchScriptRequest{
		Title: "新剧本", Content: "新正文", Status: SmartFilmScriptStatusDraft, ExpectedRevision: saved.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	var stored model.SmartFilmProductionRun
	if err := db.First(&stored, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != SmartFilmProductionRunStatusArchived || stored.CurrentStep != SmartFilmProductionStepArchived || stored.ArchiveReason != smartFilmArchiveReasonRegenerated || stored.ArchivedAt == nil {
		t.Fatalf("archived run = %+v", stored)
	}
	active, err := svc.repo.SmartFilmProductionRunsForBatch("user-1", saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(active) != 0 {
		t.Fatalf("archived run leaked into active batch response: %+v", active)
	}
	if _, err := svc.ControlSmartFilmProductionRun("user-1", saved.ID, run.ID, SmartFilmProductionRunControlRequest{Action: "resume"}); err == nil {
		t.Fatal("archived production run accepted a control action")
	}
}

func TestSmartFilmScriptTableKeepsVersionsAndSupportsFilters(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "独立剧本表", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "旧标题", Content: "旧正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	script := saved.Scripts[0]
	updated, err := svc.UpdateSmartFilmBatchScript("user-1", saved.ID, script.ID, UpdateSmartFilmBatchScriptRequest{
		Title: "新标题", Content: "新正文", Status: SmartFilmScriptStatusDraft,
		ExpectedRevision: saved.Revision, ExpectedScriptRevision: script.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Scripts[0].Revision != script.Revision+1 || updated.Scripts[0].Content != "新正文" {
		t.Fatalf("updated script = %+v", updated.Scripts[0])
	}
	var revisions []model.SmartFilmScriptRevision
	if err := db.Where("script_id = ?", script.ID).Order("version asc").Find(&revisions).Error; err != nil {
		t.Fatal(err)
	}
	if len(revisions) != 2 || revisions[1].Content != "新正文" || revisions[1].Version != 2 {
		t.Fatalf("script revisions = %+v", revisions)
	}
	found, total, err := svc.repo.QuerySmartFilmScripts("user-1", repository.SmartFilmScriptFilter{Title: "新标", Status: SmartFilmScriptStatusDraft})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(found) != 1 || found[0].ID != script.ID {
		t.Fatalf("script query = %+v total=%d", found, total)
	}
}

func TestSmartFilmScriptRejectsStaleScriptRevision(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "并发控制", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "并发剧本", Content: "正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateSmartFilmBatchScript("user-1", saved.ID, saved.Scripts[0].ID, UpdateSmartFilmBatchScriptRequest{
		Title: "过期修改", Content: "不应写入", Status: SmartFilmScriptStatusDraft,
		ExpectedRevision: saved.Revision, ExpectedScriptRevision: saved.Scripts[0].Revision + 10,
	}); err == nil {
		t.Fatal("stale script revision was accepted")
	}
	current, err := svc.smartFilmScripts(&model.SmartFilmBatch{ID: saved.ID, UserID: "user-1"})
	if err != nil {
		t.Fatal(err)
	}
	if current[0].Content != "正文" || current[0].Title != "并发剧本" {
		t.Fatalf("stale update changed script: %+v", current[0])
	}
}

func TestRecoverSmartFilmBatchScriptsFromSucceededTask(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "恢复剧本", SourceText: "想法"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	task := model.Task{
		ID: "recover-script-task", UserID: "user-1", Type: "canvas_text", Status: model.TaskStatusSucceeded,
		InputJSON:  `{"metadata":{"batchId":"` + created.ID + `","source":"smart-film-batch-script"}}`,
		ResultJSON: `{"mode":"text","text":"{\"scripts\":[{\"title\":\"恢复一\",\"content\":\"创意方向：测试。\"},{\"title\":\"恢复二\",\"content\":\"创意方向：测试二。\"}]}"}`,
		CreatedAt:  now, UpdatedAt: now,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	recovered, err := svc.RecoverSmartFilmBatchScripts("user-1", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(recovered.Scripts) != 2 || recovered.Scripts[0].Title != "恢复一" || recovered.Scripts[0].TaskID != task.ID {
		t.Fatalf("recovered scripts = %+v", recovered.Scripts)
	}
	replayed, err := svc.RecoverSmartFilmBatchScripts("user-1", created.ID)
	if err != nil || len(replayed.Scripts) != 2 {
		t.Fatalf("recovery replay = %+v, %v", replayed.Scripts, err)
	}
}

func TestSmartFilmAssetExtractionWorkItemIsQueuedForWorker(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	now := time.Now()
	resource := model.Resource{ID: "uploaded-reference", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{
		Title: "后台提取", SourceText: "想法", InputAssetIDs: []string{resource.ID},
		Config: SmartFilmBatchConfig{DefaultTextModel: "channel-1::text-model", InputAssetRoles: map[string]string{resource.ID: "product"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
		ExpectedRevision: created.Revision,
		Scripts:          []SmartFilmScriptInput{{Title: "独立剧本", Content: "独立正文"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	configureSmartFilmBatchFixed(t, svc, &saved, 1)
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	runID := confirmed.ProductionRuns[0].ID
	if _, err := svc.StartSmartFilmProductionStage("user-1", saved.ID, runID, StartSmartFilmProductionStageRequest{Stage: SmartFilmProductionStepAssets}); err != nil {
		t.Fatal(err)
	}
	items, err := svc.SmartFilmAssetExtractionWorkItems(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].RunID != runID || items[0].TextModel != "channel-1::text-model" || items[0].ScriptContent != "独立正文" || len(items[0].ExistingAssets) != 1 || items[0].ExistingAssets[0].Title != "产品参考" {
		t.Fatalf("asset work items = %+v", items)
	}
}

func TestSmartFilmVideoTaskRequiresConfirmedShot(t *testing.T) {
	for _, projectType := range []string{"smart-film", "smart-film-auto"} {
		t.Run(projectType, func(t *testing.T) {
			svc, db := newTestService(t, &recordingWorkflows{})
			project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "视频确认门禁", Type: projectType})
			if err != nil {
				t.Fatal(err)
			}
			unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "独立视频", SourceText: "剧本"})
			if err != nil {
				t.Fatal(err)
			}
			shot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
				UnitID: unit.ID, Title: "镜头 1", Position: 0, DurationMs: 3000,
				Revision: ShotRevisionInput{PlotDescription: "镜头画面", DurationMs: 3000},
			})
			if err != nil {
				t.Fatal(err)
			}
			input := map[string]any{"mode": "video", "metadata": map[string]any{"shotId": shot.ID}}
			if err := svc.EnsureSmartFilmVideoTaskAllowed("user-1", project.ID, input); err == nil {
				t.Fatal("video task was allowed before storyboard confirmation")
			}
			confirmedShot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
				ID: shot.ID, UnitID: unit.ID, Title: shot.Title, Position: shot.Position, DurationMs: 3000, Status: "confirmed",
				Revision: ShotRevisionInput{PlotDescription: "镜头画面", DurationMs: 3000},
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.EnsureSmartFilmVideoTaskAllowed("user-1", project.ID, input); err == nil {
				t.Fatal("video task was allowed before storyboard image confirmation")
			}
			now := time.Now()
			if err := db.Create(&model.ShotArtifact{
				ID: "video-gate-storyboard", ProjectID: project.ID, UnitID: unit.ID, ShotID: confirmedShot.ID,
				RevisionID: confirmedShot.CurrentRevisionID, Type: "storyboard", Version: 1,
				ResourceID: "video-gate-resource", Status: "ready", Selected: true, CreatedAt: now, UpdatedAt: now,
			}).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := svc.ReviewProjectShot("user-1", project.ID, confirmedShot.ID, ReviewProjectShotRequest{
				Status: "approved", ExpectedRevisionID: confirmedShot.CurrentRevisionID,
			}); err != nil {
				t.Fatal(err)
			}
			if err := svc.EnsureSmartFilmVideoTaskAllowed("user-1", project.ID, input); err != nil {
				t.Fatalf("approved storyboard was rejected: %v", err)
			}
		})
	}
}

func TestProjectPersistsDefaultVideoResolution(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{
		Name: "清晰度项目", Type: "smart-film", AspectRatio: "9:16", SourceType: "text",
		DefaultVideoModel: "beefapi::seedance-2.5-flash-multi", DefaultVideoResolution: "480p",
	})
	if err != nil {
		t.Fatal(err)
	}
	if project.DefaultVideoResolution != "480p" {
		t.Fatalf("created resolution = %q", project.DefaultVideoResolution)
	}
	resolution := "720p"
	updated, err := svc.UpdateProject("user-1", project.ID, UpdateProjectRequest{DefaultVideoResolution: &resolution})
	if err != nil {
		t.Fatal(err)
	}
	if updated.DefaultVideoResolution != "720p" {
		t.Fatalf("updated resolution = %q", updated.DefaultVideoResolution)
	}
}

func TestSmartFilmWholeVideoTaskRequiresReadyStoryboardsWithoutPromptConfirmation(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "整片视频门禁", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "整片", SourceText: "剧本"})
	if err != nil {
		t.Fatal(err)
	}
	shot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		UnitID: unit.ID, Title: "镜头 1", Position: 0, DurationMs: 5000, Status: "draft",
		Revision: ShotRevisionInput{PlotDescription: "镜头画面", DurationMs: 5000},
	})
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]any{
		"mode": "video",
		"metadata": map[string]any{
			"source": "smart-film-whole-video", "artifactType": "smart_film", "unitId": unit.ID,
		},
	}
	if err := svc.EnsureSmartFilmVideoTaskAllowed("user-1", project.ID, input); err == nil {
		t.Fatal("whole-film video was allowed without a ready storyboard")
	}
	now := time.Now()
	if err := db.Create(&model.ShotArtifact{
		ID: "whole-film-storyboard", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID,
		RevisionID: shot.CurrentRevisionID, Type: "storyboard", Version: 1,
		ResourceID: "whole-film-resource", Status: "ready", Selected: true, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSmartFilmVideoTaskAllowed("user-1", project.ID, input); err != nil {
		t.Fatalf("ready whole-film video task was rejected by prompt confirmation state: %v", err)
	}
}

func TestSmartFilmScriptSourceChangeInvalidatesConfirmedShots(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	project, err := svc.CreateProject("user-1", CreateProjectRequest{Name: "剧本变更", Type: "smart-film"})
	if err != nil {
		t.Fatal(err)
	}
	unit, err := svc.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "独立视频", SourceText: "旧剧本"})
	if err != nil {
		t.Fatal(err)
	}
	shot, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
		UnitID: unit.ID, Title: "镜头 1", Position: 0, DurationMs: 3000, Status: "confirmed",
		Revision: ShotRevisionInput{PlotDescription: "旧剧本镜头", DurationMs: 3000},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateProjectUnit("user-1", project.ID, unit.ID, UpdateProjectUnitRequest{
		Title: unit.Title, SourceText: "新剧本内容",
	}); err != nil {
		t.Fatal(err)
	}
	var stored model.Shot
	if err := db.First(&stored, "id = ?", shot.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != "draft" {
		t.Fatalf("shot status = %q, want draft after script source changed", stored.Status)
	}
	if err := svc.EnsureSmartFilmVideoTaskAllowed("user-1", project.ID, map[string]any{
		"mode": "video", "metadata": map[string]any{"shotId": shot.ID},
	}); err == nil {
		t.Fatal("video task was allowed after script source changed")
	}
}

func TestSmartFilmProductAliasUsesSharedInputName(t *testing.T) {
	config := SmartFilmBatchConfig{
		InputAssetRoles: map[string]string{"product-front": "product", "product-side": "product"},
		InputAssetNames: map[string]string{"product-front": "机甲狂鲨", "product-side": "机甲狂鲨"},
	}
	if got := smartFilmProductAlias(config, nil, "其他项目"); got != "机甲狂鲨" {
		t.Fatalf("product alias = %q, want 机甲狂鲨", got)
	}
}

func TestSmartFilmProductAliasFallsBackToProjectNameCandidate(t *testing.T) {
	config := SmartFilmBatchConfig{
		InputAssetRoles: map[string]string{"product-front": "product"},
		InputAssetNames: map[string]string{"product-front": "产品"},
	}
	candidates := []model.ProjectAssetCandidate{
		{Name: "急救运输舱", Category: model.AssetCategoryProp},
		{Name: "机甲狂鲨", Category: model.AssetCategoryProp},
	}
	if got := smartFilmProductAlias(config, candidates, "机甲狂鲨：60秒海底急救赛"); got != "机甲狂鲨" {
		t.Fatalf("fallback product alias = %q, want 机甲狂鲨", got)
	}
}
