package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/beefapi"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/platformchannels"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

// workspaceBootstrap is the desktop bootstrap read model. Model config itself
// still comes from the provider port on the request.
type workspaceBootstrap interface {
	beefAPIConnections
	WorkspaceOwner(string) (*model.User, error)
	PublicRuntimeLimits() (*platform.PublicRuntimeLimits, error)
	FeatureAvailability() (*platform.PublicFeatureAvailability, error)
	DataDir() string
	ReadLocalModelConfig() ([]byte, error)
	SaveLocalModelConfig([]byte) error
}

// RegisterWorkspaceRoutes exposes the desktop-first bootstrap contract. The
// workspace scope is injected by the runtime before the router is mounted, so
// this endpoint never reads a cookie or creates an AuthSession.
// configs is only the model-config fallback for requests that have no injected
// provider port; bootstrap owns identity, limits, features, and the connection.
func RegisterWorkspaceRoutes(r *gin.RouterGroup, bootstrap workspaceBootstrap) {
	r.GET("/workspace/bootstrap", func(c *gin.Context) {
		scope, err := CurrentWorkspace(c)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		user, err := currentUser(c, bootstrap)
		if err != nil {
			failService(c, err)
			return
		}
		// 托管形态：用户名/昵称/头像以主站身份为准（画布工作区行本身不含这些资料）。
		userPayload := gin.H{
			"id": user.ID, "username": user.Username, "displayName": user.DisplayName,
			"role": user.Role, "status": user.Status,
			"createdAt": user.CreatedAt, "updatedAt": user.UpdatedAt,
		}
		if identity, ok := WorkspaceIdentity(c); ok {
			if identity.Username != "" {
				userPayload["username"] = identity.Username
				userPayload["identityUsername"] = identity.Username
			}
			if identity.DisplayName != "" {
				userPayload["displayName"] = identity.DisplayName
			}
			if identity.Avatar != "" {
				userPayload["avatarUrl"] = identity.Avatar
			}
			userPayload["identityProvider"] = "aicyld"
		}
		// Desktop model configuration is persisted separately under the workspace
		// data directory. The bootstrap contract contains no account metadata.
		logicalModels := []app.PublicLogicalModel{}
		limits, err := bootstrap.PublicRuntimeLimits()
		if err != nil {
			failService(c, err)
			return
		}
		features, err := bootstrap.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		contract := LocalDesktopContract()
		profile := contract.Profile
		storageMode := "local"
		workspaceName := "本地工作区"
		workspaceOwner := "local"
		if SSOConfigured() {
			profile = "hosted"
			storageMode = "remote"
			workspaceOwner = "account"
			if name := strings.TrimSpace(user.DisplayName); name != "" {
				workspaceName = name
			}
		}
		ok(c, gin.H{
			"contractVersion": contract.Version,
			"profile":         profile,
			"capabilities":    contract.Capabilities,
			"workspace": gin.H{
				"id":      scope.ID,
				"name":    workspaceName,
				"owner":   workspaceOwner,
				"storage": "sqlite",
			},
			"user":          userPayload,
			"storageMode":   storageMode,
			"logicalModels": logicalModels,
			"runtimeLimits": limits,
			"features":      features,
		})
	})
	r.GET("/workspace/model-config", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, bootstrap); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		providerConfig := requestProviderConfig(c, bootstrap)
		if versioned, supportsVersioning := providerConfig.(VersionedProviderConfig); supportsVersioning {
			effective, health, err := versioned.LoadEffectiveModelConfig()
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{
				"config":        publicModelConfig(c, bootstrap, effective.Config),
				"revision":      effective.Revision,
				"health":        health,
				"source":        "builtin+local",
				"featureModels": platformFeatureModels(bootstrap),
			})
			return
		}
		body, err := providerConfig.ReadLocalModelConfig()
		if err != nil {
			failService(c, err)
			return
		}
		if len(body) == 0 {
			ok(c, gin.H{"config": nil})
			return
		}
		var config map[string]any
		if err := json.Unmarshal(body, &config); err != nil {
			fail(c, http.StatusInternalServerError, errors.New("本地模型配置损坏"))
			return
		}
		ok(c, gin.H{"config": publicModelConfig(c, bootstrap, config), "featureModels": platformFeatureModels(bootstrap)})
	})
	r.PUT("/workspace/model-config", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, bootstrap); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20))
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("本地模型配置读取失败"))
			return
		}
		var envelope struct {
			Config           json.RawMessage `json:"config"`
			ExpectedRevision *int64          `json:"expectedRevision"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil || len(envelope.Config) == 0 || string(envelope.Config) == "null" {
			fail(c, http.StatusBadRequest, errors.New("本地模型配置格式错误"))
			return
		}
		if _, external := externalBusiness(c); external && envelope.ExpectedRevision == nil {
			fail(c, http.StatusBadRequest, errors.New("修改模型配置需要 expectedRevision"))
			return
		}
		if err := requireModelConfigWrite(c); err != nil {
			fail(c, http.StatusForbidden, err)
			return
		}
		// Platform channels are server-owned. Ignore stale browser copies so a
		// settings save can never turn the placeholder credential into storage.
		envelope.Config = stripPlatformChannelConfig(envelope.Config)
		envelope.Config = preserveManagedModelConfig(c, bootstrap, envelope.Config)
		providerConfig := requestProviderConfig(c, bootstrap)
		if versioned, supportsVersioning := providerConfig.(VersionedProviderConfig); supportsVersioning && envelope.ExpectedRevision != nil {
			revision, err := versioned.SaveLocalModelConfigRevision(envelope.Config, *envelope.ExpectedRevision)
			if errors.Is(err, workspace.ErrProviderConfigRevisionConflict) {
				fail(c, http.StatusConflict, err)
				return
			}
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"saved": true, "revision": revision})
			return
		}
		if err := providerConfig.SaveLocalModelConfig(envelope.Config); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"saved": true})
	})
	r.POST("/workspace/model-config/capability", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, bootstrap); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 512<<10))
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型能力草稿读取失败"))
			return
		}
		var draft modelcatalog.ModelCapabilityDraft
		if err := json.Unmarshal(body, &draft); err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型能力草稿格式错误"))
			return
		}
		normalized, err := requestModelCapability(c).NormalizeModelCapabilityDraft(draft)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, gin.H{
			"version":          normalized.Version,
			"text":             normalized.Text,
			"image":            normalized.Image,
			"video":            normalized.Video,
			"capabilityConfig": normalized,
		})
	})
}

// requireModelConfigWrite keeps hosted workspace users read-only. The internal
// channel API remains the only platform-managed write path and uses its own
// server-to-server credential.
func requireModelConfigWrite(c *gin.Context) error {
	if !SSOConfigured() {
		return nil
	}
	if value, exists := c.Get(workspaceAdminKey); exists {
		if allowed, ok := value.(bool); ok && allowed {
			return nil
		}
	}
	return errors.New("模型配置由平台统一维护，如需调整请联系管理员")
}

func platformFeatureModels(bootstrap workspaceBootstrap) map[string]string {
	store, err := platformchannels.New(bootstrap.DataDir())
	if err != nil || !store.Configured() {
		return map[string]string{}
	}
	features, err := store.FeatureModels()
	if err != nil {
		logPlatformChannelFailure(err)
		return map[string]string{}
	}
	if features == nil {
		return map[string]string{}
	}
	return features
}

// publicModelConfig injects only redacted platform channels. Real API keys stay
// on disk and are resolved by the server-side relay when a placeholder key is
// presented.
func publicModelConfig(c *gin.Context, bootstrap workspaceBootstrap, config map[string]any) map[string]any {
	redacted := redactModelConfig(c, bootstrap, config)
	store, err := platformchannels.New(bootstrap.DataDir())
	if err != nil || !store.Configured() {
		return redacted
	}
	channels, err := store.List()
	if err != nil {
		logPlatformChannelFailure(err)
		return redacted
	}
	return platformchannels.Apply(redacted, channels)
}

func stripPlatformChannelConfig(raw json.RawMessage) json.RawMessage {
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return raw
	}
	encoded, err := json.Marshal(platformchannels.Strip(value))
	if err != nil {
		return raw
	}
	return encoded
}

func logPlatformChannelFailure(err error) {
	fmt.Fprintf(os.Stderr, "[canvas] 读取平台渠道配置失败: %v\n", err)
}

func redactModelConfig(c *gin.Context, connections beefAPIConnections, config map[string]any) map[string]any {
	if _, external := externalBusiness(c); external {
		// 标记要在清空密钥之前算出来，否则前端只能看到一对空字符串。
		config = markExternalCredentialState(redactExternalConfig(config), config)
	}
	managed := false
	if connection, err := requestBeefAPI(c, connections); err == nil && connection != nil {
		managed = connection.HasManagedCredential()
		return connection.RedactConfig(config)
	}
	return beefapi.RedactConfig(config, managed)
}

func preserveManagedModelConfig(c *gin.Context, bootstrap workspaceBootstrap, raw json.RawMessage) json.RawMessage {
	var incoming map[string]any
	if err := json.Unmarshal(raw, &incoming); err != nil {
		return raw
	}
	existing := map[string]any{}
	providerConfig := requestProviderConfig(c, bootstrap)
	if versioned, ok := providerConfig.(VersionedProviderConfig); ok {
		if effective, _, err := versioned.LoadEffectiveModelConfig(); err == nil {
			existing = effective.Config
		}
	}
	managed := false
	if _, external := externalBusiness(c); external {
		preserveExternalConfigSecrets(incoming, existing)
	}
	if connection, err := requestBeefAPI(c, bootstrap); err == nil && connection != nil {
		managed = connection.HasManagedCredential()
		connection.PreserveWrite(incoming, existing)
	} else {
		beefapi.PreserveManagedChannel(incoming, existing, managed)
	}
	encoded, err := json.Marshal(incoming)
	if err != nil {
		return raw
	}
	return encoded
}

func workspaceForLocalRequest(c *gin.Context, connections beefAPIConnections) (workspace.Context, error) {
	if scope, err := CurrentWorkspace(c); err == nil {
		return scope, nil
	}
	if connections.IsLocalMode() {
		return workspace.Context{ID: "local"}, nil
	}
	return workspace.Context{}, errors.New("本地工作区未初始化")
}
