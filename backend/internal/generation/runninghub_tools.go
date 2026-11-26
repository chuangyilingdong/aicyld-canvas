package generation

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

const (
	RunningHubImageUpscaleEndpoint     = "topazlabs/image-upscale-standard-v2"
	RunningHubVideoUpscaleEndpoint     = "rhart-video/rh-upscale/enhance-frame"
	RunningHubSubtitleEraseEndpoint    = "volc-subtitle-erase/video"
	RunningHubSubtitleEraseProEndpoint = "volc-subtitle-erase-pro/video"
)

func IsRunningHubManagedMediaTool(input Input) bool {
	modelKey := strings.TrimPrefix(strings.TrimSpace(firstNonEmpty(input.Config.ProviderModelKey, input.Config.Model)), "/")
	switch {
	case input.Config.InterfaceType == string(model.ChannelInterfaceRunningHubStandardImage):
		return modelKey == RunningHubImageUpscaleEndpoint && input.Upscale != nil
	case input.Config.InterfaceType == string(model.ChannelInterfaceRunningHubStandardVideo):
		return (modelKey == RunningHubVideoUpscaleEndpoint && input.Upscale != nil) ||
			((modelKey == RunningHubSubtitleEraseEndpoint || modelKey == RunningHubSubtitleEraseProEndpoint) && input.SubtitleErase != nil)
	default:
		return false
	}
}

func runRunningHubManagedMediaTool(ctx context.Context, input Input) (map[string]any, error) {
	if !IsRunningHubManagedMediaTool(input) {
		return nil, RequestPreparationError{Cause: errors.New("RunningHub 媒体工具 endpoint 与任务参数不匹配")}
	}
	if input.SubtitleErase != nil && (input.SubtitleErase.EraseMethod != "auto" || input.SubtitleErase.Region != nil) {
		return nil, RequestPreparationError{Cause: errors.New("当前 RunningHub 字幕擦除接口仅支持自动识别模式")}
	}
	runtime, _ := RuntimeFromContext(ctx)
	if strings.TrimSpace(runtime.Call.UserID) == "" {
		return nil, RequestPreparationError{Cause: errors.New("RunningHub 媒体工具缺少用户素材归属")}
	}
	if err := HydrateMedia(ctx, runtime.Call.UserID, &input, MediaHydrationPolicyFor(ctx, input)); err != nil {
		return nil, RequestPreparationError{Cause: err}
	}
	adapter, ok := protocol.Builtins().Get(input.Config.InterfaceType)
	if !ok {
		return nil, errors.New("RunningHub 标准媒体协议未安装")
	}
	result, err := RunProtocolAdapterTask(ctx, input, adapter)
	if err != nil {
		return nil, err
	}
	return restoreRunningHubManagedToolAudio(ctx, input, result)
}

func recoverRunningHubManagedMediaTool(ctx context.Context, input Input, taskID string) (map[string]interface{}, string, error) {
	if !IsRunningHubManagedMediaTool(input) {
		return nil, "", errors.New("RunningHub 媒体工具 endpoint 与原任务不匹配")
	}
	ctx = EnsureOfficialProtocolAdapter(ctx, input.Config.InterfaceType)
	adapter, ok := protocol.Builtins().Get(input.Config.InterfaceType)
	if !ok {
		return nil, "", errors.New("RunningHub 标准媒体协议未安装")
	}
	result, status, err := QueryProtocolAdapterTask(ctx, input, adapter, taskID)
	if err != nil || result == nil {
		return result, status, err
	}
	restored, restoreErr := restoreRunningHubManagedToolAudio(ctx, input, result)
	if restoreErr != nil {
		return nil, status, restoreErr
	}
	return restored, status, nil
}

func restoreRunningHubManagedToolAudio(ctx context.Context, input Input, result map[string]any) (map[string]any, error) {
	if input.Mode != "video" || result == nil {
		return result, nil
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok {
		return nil, errors.New("RunningHub 媒体工具没有返回视频结果")
	}
	dataURL, _ := video["dataUrl"].(string)
	if strings.TrimSpace(dataURL) == "" {
		return nil, errors.New("RunningHub 媒体工具视频结果为空")
	}
	_, data, err := DecodeProviderDataURL(dataURL)
	if err != nil {
		return nil, fmt.Errorf("读取 RunningHub 视频结果失败：%w", err)
	}
	if input.Upscale != nil {
		data, err = RestoreUpscaleSourceAudio(ctx, input, data)
	} else if input.SubtitleErase != nil {
		data, err = RestoreSubtitleEraseSourceAudio(ctx, input, data)
	}
	if err != nil {
		return nil, err
	}
	video["dataUrl"] = DataURL("video/mp4", data)
	video["mimeType"] = "video/mp4"
	return result, nil
}
