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
	"infinite-canvas/backend/internal/platformchannels"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

// RegisterWorkspaceRoutes exposes the desktop-first bootstrap contract. The
// workspace scope is injected by the runtime before the router is mounted, so
// this endpoint never reads a cookie or creates an AuthSession.
func RegisterWorkspaceRoutes(r *gin.RouterGroup, svc *app.Service) {
	r.GET("/workspace/bootstrap", func(c *gin.Context) {
		scope, err := CurrentWorkspace(c)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		// 走 currentUser 而非直接 WorkspaceOwner：托管部署下它负责把角色
		// 收紧为普通用户（只有白名单主站用户是管理员）。
		user, err := currentUser(c, svc)
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
		limits, err := svc.PublicRuntimeLimits()
		if err != nil {
			failService(c, err)
			return
		}
		features, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		contract := LocalDesktopContract()
		// 主站登录（SSO）启用时，这个部署是多用户托管形态：前端据此切到 hosted 存储路径，
		// 项目/画布/素材以服务端为准，模型渠道使用后台配置的系统渠道。
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
			"features":      hostedFeatureOverrides(features),
		})
	})
	r.GET("/workspace/model-config", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		providerConfig := requestProviderConfig(c, svc)
		if versioned, supportsVersioning := providerConfig.(VersionedProviderConfig); supportsVersioning {
			effective, health, err := versioned.LoadEffectiveModelConfig()
			if err != nil {
				failService(c, err)
				return
			}
			// 「功能 → 模型」映射随模型配置一起下发：画布各功能（图片编辑、视频各模式、
			// 配音等）直接取用平台内置的模型，用户端不再自己挑模型。
			ok(c, gin.H{"config": publicModelConfig(c, svc, effective.Config), "revision": effective.Revision,
				"health": health, "source": "builtin+local", "featureModels": platformFeatureModels(svc)})
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
		ok(c, gin.H{"config": publicModelConfig(c, svc, config)})
	})
	r.PUT("/workspace/model-config", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
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
		// 平台渠道由服务端统一注入，客户端回传的副本一律忽略。
		envelope.Config = stripPlatformChannelConfig(envelope.Config)
		envelope.Config = preserveManagedModelConfig(c, svc, envelope.Config)
		providerConfig := requestProviderConfig(c, svc)
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
}

// requireModelConfigWrite 锁定模型配置写入口：托管部署下只有白名单管理员可写，
// 普通用户改由主站后台（/api/internal/channels）统一维护。
func requireModelConfigWrite(c *gin.Context) error {
	if !SSOConfigured() {
		return nil
	}
	if value, exists := c.Get(workspaceAdminKey); exists {
		if allowed, _ := value.(bool); allowed {
			return nil
		}
	}
	return errors.New("模型配置由平台统一维护，如需调整请联系管理员")
}

// platformFeatureModels 读出「功能 → 模型」映射供画布使用（读不到就返回空对象）。
func platformFeatureModels(svc *app.Service) map[string]string {
	if svc == nil {
		return map[string]string{}
	}
	store, err := platformchannels.New(svc.DataDir())
	if err != nil {
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

// publicModelConfig 在脱敏的基础上注入平台统一渠道：密钥不下发，
// 浏览器只拿到指向上游的地址与占位密钥。
func publicModelConfig(c *gin.Context, svc *app.Service, config map[string]any) map[string]any {
	redacted := redactModelConfig(c, svc, config)
	store, err := platformchannels.New(svc.DataDir())
	if err != nil {
		return redacted
	}
	channels, err := store.List()
	if err != nil {
		logPlatformChannelFailure(err)
		return redacted
	}
	return platformchannels.Apply(redacted, channels)
}

// stripPlatformChannelConfig 移除客户端回传里的平台渠道副本。
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

func redactModelConfig(c *gin.Context, svc *app.Service, config map[string]any) map[string]any {
	if _, external := externalBusiness(c); external {
		config = redactExternalConfig(config)
	}
	managed := false
	if connection, err := requestBeefAPI(c, svc); err == nil && connection != nil {
		managed = connection.HasManagedCredential()
		return connection.RedactConfig(config)
	}
	return beefapi.RedactConfig(config, managed)
}

func preserveManagedModelConfig(c *gin.Context, svc *app.Service, raw json.RawMessage) json.RawMessage {
	var incoming map[string]any
	if err := json.Unmarshal(raw, &incoming); err != nil {
		return raw
	}
	existing := map[string]any{}
	providerConfig := requestProviderConfig(c, svc)
	if versioned, ok := providerConfig.(VersionedProviderConfig); ok {
		if effective, _, err := versioned.LoadEffectiveModelConfig(); err == nil {
			existing = effective.Config
		}
	}
	managed := false
	if _, external := externalBusiness(c); external {
		preserveExternalConfigSecrets(incoming, existing)
	}
	if connection, err := requestBeefAPI(c, svc); err == nil && connection != nil {
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

func workspaceForLocalRequest(c *gin.Context, svc *app.Service) (workspace.Context, error) {
	if scope, err := CurrentWorkspace(c); err == nil {
		return scope, nil
	}
	if svc.IsLocalMode() {
		return workspace.Context{ID: "local"}, nil
	}
	return workspace.Context{}, errors.New("本地工作区未初始化")
}
