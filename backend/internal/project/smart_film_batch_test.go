package project

import (
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
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
			ShotDurationSeconds: 5, ShotDurationsSeconds: []float64{4, 7},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Config.AspectRatio != "16:9" || len(created.Config.ShotDurationsSeconds) != 2 || created.Config.ShotDurationsSeconds[1] != 7 {
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
	}
	for _, testCase := range cases {
		if _, err := svc.CreateSmartFilmBatch("user-1", testCase.req); err == nil {
			t.Fatalf("%s was accepted", testCase.name)
		}
	}
}

func TestSmartFilmBatchPauseResumeSkipAndRetryPreserveTask(t *testing.T) {
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
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	runID := confirmed.ProductionRuns[0].ID
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
	retried, err := svc.ControlSmartFilmProductionRun("user-1", saved.ID, runID, SmartFilmProductionRunControlRequest{Action: "retry", Stage: SmartFilmProductionStepAssets})
	if err != nil {
		t.Fatal(err)
	}
	if retried.AssetTaskID != "existing-task" || retried.AssetStatus != SmartFilmProductionStageStatusQueued || retried.Status != SmartFilmProductionRunStatusReady {
		t.Fatalf("retried run = %+v", retried)
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

func TestSmartFilmBatchListFiltersAndDeletesDraft(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
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
	if _, err := svc.ConfirmSmartFilmBatchScripts("user-1", confirmed.ID, ConfirmSmartFilmBatchScriptsRequest{
		ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID},
	}); err != nil {
		t.Fatal(err)
	}
	page, err := svc.ListSmartFilmBatches("user-1", SmartFilmScriptStatusDraft, 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Batches) != 1 || page.Batches[0].ID != draft.ID {
		t.Fatalf("draft batch list = %+v", page)
	}
	if err := svc.DeleteSmartFilmBatchDraft("user-1", confirmed.ID); err == nil {
		t.Fatal("confirmed batch was deleted as draft")
	}
	if err := svc.DeleteSmartFilmBatchDraft("user-1", draft.ID); err != nil {
		t.Fatal(err)
	}
	page, err = svc.ListSmartFilmBatches("user-1", "", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Batches[0].ID != confirmed.ID {
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
	scriptsJSON, err := json.Marshal(partial)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SmartFilmBatch{}).Where("id = ?", saved.ID).Updates(map[string]any{
		"scripts_json": string(scriptsJSON), "revision": saved.Revision + 1,
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

func TestSmartFilmAssetExtractionWorkItemIsQueuedForWorker(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{
		Title: "后台提取", SourceText: "想法",
		Config: SmartFilmBatchConfig{DefaultTextModel: "channel-1::text-model"},
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
	if len(items) != 1 || items[0].RunID != runID || items[0].TextModel != "channel-1::text-model" || items[0].ScriptContent != "独立正文" {
		t.Fatalf("asset work items = %+v", items)
	}
}

func TestSmartFilmVideoTaskRequiresConfirmedShot(t *testing.T) {
	for _, projectType := range []string{"smart-film", "smart-film-auto"} {
		t.Run(projectType, func(t *testing.T) {
			svc, _ := newTestService(t, &recordingWorkflows{})
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
			if _, err := svc.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
				ID: shot.ID, UnitID: unit.ID, Title: shot.Title, Position: shot.Position, DurationMs: 3000, Status: "confirmed",
				Revision: ShotRevisionInput{PlotDescription: "镜头画面", DurationMs: 3000},
			}); err != nil {
				t.Fatal(err)
			}
			if err := svc.EnsureSmartFilmVideoTaskAllowed("user-1", project.ID, input); err != nil {
				t.Fatalf("confirmed shot was rejected: %v", err)
			}
		})
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
