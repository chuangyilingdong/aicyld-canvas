package project

import "time"

const (
	SmartFilmScriptStatusDraft           = "draft"
	SmartFilmScriptStatusProjectCreated  = "project_created"
	SmartFilmScriptStatusAssetsExtracted = "assets_extracted"
	SmartFilmScriptStatusStoryboardReady = "storyboard_ready"
	SmartFilmScriptStatusNeedsAttention  = "needs_attention"
	SmartFilmScriptStatusFailed          = "failed"

	SmartFilmProductionRunStatusPending        = "pending"
	SmartFilmProductionRunStatusReady          = "ready"
	SmartFilmProductionRunStatusNeedsAttention = "needs_attention"
	SmartFilmProductionRunStatusFailed         = "failed"
	SmartFilmProductionStageStatusPending      = "pending"
	SmartFilmProductionStageStatusWaiting      = "waiting"
	SmartFilmProductionStageStatusQueued       = "queued"
	SmartFilmProductionStageStatusRunning      = "running"
	SmartFilmProductionStageStatusReady        = "ready"
	SmartFilmProductionStageStatusAttention    = "needs_attention"

	SmartFilmProductionStepProject           = "project"
	SmartFilmProductionStepUnit              = "unit"
	SmartFilmProductionStepAssetLink         = "asset_link"
	SmartFilmProductionStepBatch             = "batch_update"
	SmartFilmProductionStepAssets            = "assets"
	SmartFilmProductionStepStoryboard        = "storyboard"
	SmartFilmProductionStepCompleted         = "completed"
	SmartFilmProductionActionRetry           = "retry_confirm"
	SmartFilmProductionActionRetryAssets     = "retry_assets"
	SmartFilmProductionActionRetryStoryboard = "retry_storyboard"
)

type SmartFilmBatchConfig struct {
	AspectRatio          string    `json:"aspectRatio"`
	StylePresetID        string    `json:"stylePresetId,omitempty"`
	StyleProfileJSON     string    `json:"styleProfileJson,omitempty"`
	DefaultTextModel     string    `json:"defaultTextModel,omitempty"`
	DefaultImageModel    string    `json:"defaultImageModel,omitempty"`
	DefaultVideoModel    string    `json:"defaultVideoModel,omitempty"`
	ScriptCount          int       `json:"scriptCount"`
	ShotCount            int       `json:"shotCount"`
	ShotDurationSeconds  float64   `json:"shotDurationSeconds"`
	ShotDurationsSeconds []float64 `json:"shotDurationsSeconds,omitempty"`
}

type SmartFilmScript struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Status    string    `json:"status"`
	ProjectID string    `json:"projectId,omitempty"`
	UnitID    string    `json:"unitId,omitempty"`
	TaskID    string    `json:"taskId,omitempty"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type SmartFilmProductionResources struct {
	ProjectID      string   `json:"projectId,omitempty"`
	UnitID         string   `json:"unitId,omitempty"`
	LinkedAssetIDs []string `json:"linkedAssetIds"`
}

type SmartFilmProductionRunView struct {
	ID                  string                       `json:"id"`
	BatchID             string                       `json:"batchId"`
	ScriptID            string                       `json:"scriptId"`
	IdempotencyKey      string                       `json:"idempotencyKey"`
	Status              string                       `json:"status"`
	CurrentStep         string                       `json:"currentStep"`
	Resources           SmartFilmProductionResources `json:"resources"`
	FailedStep          string                       `json:"failedStep,omitempty"`
	Error               string                       `json:"error,omitempty"`
	RecoverableAction   string                       `json:"recoverableAction,omitempty"`
	AssetStatus         string                       `json:"assetStatus"`
	AssetTaskID         string                       `json:"assetTaskId,omitempty"`
	AssetCount          int                          `json:"assetCount"`
	StoryboardStatus    string                       `json:"storyboardStatus"`
	StoryboardTaskID    string                       `json:"storyboardTaskId,omitempty"`
	StoryboardShotCount int                          `json:"storyboardShotCount"`
	Attempts            int                          `json:"attempts"`
	Revision            int64                        `json:"revision"`
	CreatedAt           time.Time                    `json:"createdAt"`
	UpdatedAt           time.Time                    `json:"updatedAt"`
}

type SmartFilmBatchView struct {
	ID             string                       `json:"id"`
	Title          string                       `json:"title"`
	SourceText     string                       `json:"sourceText"`
	InputAssetIDs  []string                     `json:"inputAssetIds"`
	Config         SmartFilmBatchConfig         `json:"config"`
	Scripts        []SmartFilmScript            `json:"scripts"`
	ProductionRuns []SmartFilmProductionRunView `json:"productionRuns"`
	Status         string                       `json:"status"`
	Revision       int64                        `json:"revision"`
	CreatedAt      time.Time                    `json:"createdAt"`
	UpdatedAt      time.Time                    `json:"updatedAt"`
}

type CreateSmartFilmBatchRequest struct {
	Title         string               `json:"title"`
	SourceText    string               `json:"sourceText"`
	InputAssetIDs []string             `json:"inputAssetIds"`
	Config        SmartFilmBatchConfig `json:"config"`
}

type SmartFilmScriptInput struct {
	ID      string `json:"id,omitempty"`
	Title   string `json:"title"`
	Content string `json:"content"`
	TaskID  string `json:"taskId,omitempty"`
}

type SaveSmartFilmBatchScriptsRequest struct {
	Scripts          []SmartFilmScriptInput `json:"scripts"`
	ExpectedRevision int64                  `json:"expectedRevision"`
}

type UpdateSmartFilmBatchScriptRequest struct {
	Title            string `json:"title"`
	Content          string `json:"content"`
	Status           string `json:"status,omitempty"`
	TaskID           string `json:"taskId,omitempty"`
	ExpectedRevision int64  `json:"expectedRevision"`
}

type DeleteSmartFilmBatchScriptRequest struct {
	ExpectedRevision int64 `json:"expectedRevision"`
}

type ConfirmSmartFilmBatchScriptsRequest struct {
	ScriptIDs        []string `json:"scriptIds"`
	ExpectedRevision int64    `json:"expectedRevision"`
}

type SmartFilmProductionStageCheckpointRequest struct {
	Stage         string `json:"stage"`
	Status        string `json:"status"`
	TaskID        string `json:"taskId,omitempty"`
	Error         string `json:"error,omitempty"`
	ResourceCount int    `json:"resourceCount,omitempty"`
}

type StartSmartFilmProductionStageRequest struct {
	Stage string `json:"stage"`
}

type SmartFilmAssetExtractionWorkItem struct {
	RunID         string
	UserID        string
	BatchID       string
	ScriptID      string
	ProjectID     string
	UnitID        string
	ProjectName   string
	ProjectStyle  string
	ScriptTitle   string
	ScriptContent string
	TextModel     string
	AssetTaskID   string
	AssetStatus   string
}
