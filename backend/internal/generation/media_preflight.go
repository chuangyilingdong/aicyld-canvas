package generation

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
)

// ValidateMediaTransport uses the same installed contract as execution, without
// reading file bytes, uploading anything, or creating a provider task.
func ValidateMediaTransport(ctx context.Context, input Input) error {
	policy := MediaHydrationPolicyFor(ctx, input)
	if !policy.RequireURL || policy.KeepLocal {
		return nil
	}
	runtime, _ := RuntimeFromContext(ctx)
	portState := "未注入"
	if runtime.Resources != nil {
		portState = "托管"
		if runtime.Resources.LocalMode() {
			portState = "本地模式"
		}
	}
	var blocked []string
	var shapes []string
	groups := []struct {
		label string
		items []Media
	}{
		{"参考图片", input.ReferenceImages}, {"参考视频", input.ReferenceVideos}, {"参考音频", input.ReferenceAudios},
	}
	if input.Mask != nil {
		groups = append(groups, struct {
			label string
			items []Media
		}{"遮罩", []Media{*input.Mask}})
	}
	for _, group := range groups {
		for i, media := range group.items {
			label := fmt.Sprintf("%s %d", group.label, i+1)
			shape := ""
			if strings.HasPrefix(media.StorageKey, "resource:") {
				if resourceTransportable(runtime, media) {
					continue // 资源端口能签出上游可取的公网地址。
				}
				shape = "托管资源键但签不出公网地址"
			} else if address, err := url.Parse(strings.TrimSpace(media.URL)); err == nil && address.Scheme == "https" && address.Hostname() != "" && address.User == nil {
				continue
			} else {
				shape = "既非托管资源键也无可用 HTTPS 地址"
			}
			blocked = append(blocked, label)
			shapes = append(shapes, fmt.Sprintf("%s(%s storageKey=%s url=%s dataURL=%dB)", label, shape, storageKeyShape(media.StorageKey), urlShape(media.URL), len(media.DataURL)))
		}
	}
	if len(blocked) == 0 {
		return nil
	}
	// 这条拒绝以前完全不留痕（不写 tasks、不写 api_call_logs、不进日志），
	// 线上只能靠猜是哪个素材被拦。只记录字段形状，不记录完整地址或资源标识。
	log.Printf("[canvas-preflight] 拒绝 reference_media_requires_url model=%q interface=%q mode=%q 资源端口=%s 明细=%s",
		input.Config.Model, input.Config.InterfaceType, input.Mode, portState, strings.Join(shapes, " | "))
	return &kernel.AppError{Status: 400, Code: 400, Reason: "reference_media_requires_url", Message: "当前渠道需要在线素材链接：" + strings.Join(blocked, "、") + "无法直接读取。请替换为可访问的 HTTPS 链接，或切换支持本地素材的渠道"}
}

// storageKeyShape 只保留键前缀，避免把资源标识写进日志。
func storageKeyShape(storageKey string) string {
	key := strings.TrimSpace(storageKey)
	if key == "" {
		return "空"
	}
	if index := strings.Index(key, ":"); index > 0 {
		return key[:index] + ":…"
	}
	return "无前缀"
}

// urlShape 只保留协议与主机，用来区分 http 地址、相对路径与浏览器本地地址。
func urlShape(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "空"
	}
	address, err := url.Parse(value)
	if err != nil || address.Scheme == "" {
		return "非URL"
	}
	if address.Host == "" {
		return address.Scheme + ":无主机"
	}
	return address.Scheme + "://" + address.Host
}

// resourceTransportable 判断宿主能否把这个资源换成上游可以直接取的公网地址。
// 过去只看「本地模式」，于是托管部署（跑的是本地模式但配了对象存储与公开基址）
// 会把所有 resource: 参考素材一律拦下——这正是「填写参考素材链接」弹窗的来源。
// 现在改为真的去签一次地址：签得出 https 就放行，签不出才拒绝。
func resourceTransportable(runtime Runtime, media Media) bool {
	if runtime.Resources == nil {
		return false
	}
	if !runtime.Resources.LocalMode() {
		return true
	}
	resourceID := strings.TrimPrefix(strings.TrimSpace(media.StorageKey), "resource:")
	if resourceID == "" {
		return false
	}
	info, err := runtime.Resources.Lookup(runtime.Call.UserID, resourceID)
	if err != nil {
		return false
	}
	address, err := runtime.Resources.HTTPSPublicURL(info, time.Now().Add(ResourceURLTTL))
	return err == nil && strings.HasPrefix(address, "https://")
}
