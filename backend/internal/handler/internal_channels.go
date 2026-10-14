package handler

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"strings"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/platformchannels"

	"github.com/gin-gonic/gin"
)

// 内部管理接口：供 admin.aicyld.com.cn 后台写画布模型渠道。
//
// 鉴权用共享密钥（AICYLD_CANVAS_INTERNAL_TOKEN），不依赖主站会话：
// 后台服务端持有密钥，浏览器永远拿不到；未配置密钥时整组接口 503。
const internalChannelTokenHeader = "X-Aicyld-Internal-Token"

func internalChannelToken() string {
	return strings.TrimSpace(os.Getenv("AICYLD_CANVAS_INTERNAL_TOKEN"))
}

func internalChannelAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		want := internalChannelToken()
		if want == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"code": http.StatusServiceUnavailable, "data": nil, "msg": "画布内部接口未启用",
			})
			return
		}
		got := strings.TrimSpace(c.GetHeader(internalChannelTokenHeader))
		if got == "" {
			got = strings.TrimSpace(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
		}
		if len(got) != len(want) || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code": http.StatusUnauthorized, "data": nil, "msg": "内部接口鉴权失败",
			})
			return
		}
		c.Next()
	}
}

// RegisterInternalChannelRoutes 注册平台模型渠道的内部管理接口。
func RegisterInternalChannelRoutes(r *gin.RouterGroup, svc *app.Service) {
	group := r.Group("/internal", internalChannelAuth())

	group.GET("/channels", func(c *gin.Context) {
		store, err := platformchannels.New(svc.DataDir())
		if err != nil {
			failService(c, err)
			return
		}
		channels, assistantModel, err := store.Config()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channels": platformchannels.Redact(channels), "assistantModel": assistantModel})
	})

	group.PUT("/channels", func(c *gin.Context) {
		var payload struct {
			Channels []platformchannels.Channel `json:"channels"`
			// 指针类型：不传该字段表示保持原值，传空串表示清除（回退到默认助手模型）。
			AssistantModel *string `json:"assistantModel"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			fail(c, http.StatusBadRequest, errors.New("平台渠道配置格式错误"))
			return
		}
		store, err := platformchannels.New(svc.DataDir())
		if err != nil {
			failService(c, err)
			return
		}
		saved, err := store.SaveWithAssistantModel(payload.Channels, payload.AssistantModel)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		// 同步镜像为系统渠道：服务端任务执行路径（SelectTaskModel）只认数据库系统渠道。
		warnings := svc.SyncPlatformChannels(platformChannelSyncInputs(saved))
		assistantModel, err := store.AssistantModel()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channels": platformchannels.Redact(saved), "assistantModel": assistantModel, "warnings": warnings})
	})
}

// platformChannelSyncInputs 把落盘的平台渠道转换成系统渠道镜像输入。
func platformChannelSyncInputs(channels []platformchannels.Channel) []app.PlatformChannelInput {
	inputs := make([]app.PlatformChannelInput, 0, len(channels))
	for _, channel := range channels {
		profiles := make([]app.PlatformChannelModel, 0, len(channel.ModelProfiles))
		for _, profile := range channel.ModelProfiles {
			profiles = append(profiles, app.PlatformChannelModel{
				Model: profile.Model, DisplayName: profile.DisplayName, Capability: profile.Capability,
				Protocol: profile.Protocol, ProviderModelKey: profile.ProviderModelKey,
				CapabilityConfig: profile.CapabilityConfig, Variants: profile.Variants,
			})
		}
		inputs = append(inputs, app.PlatformChannelInput{
			ID: channel.ID, Name: channel.Name, BaseURL: channel.BaseURL, APIKey: channel.APIKey,
			ConcurrencyLimit: channel.ConcurrencyLimit, Enabled: channel.Enabled, SortOrder: channel.SortOrder,
			Models: profiles,
		})
	}
	return inputs
}
