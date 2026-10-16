package generation

import (
	"context"
	"errors"
	"log"
	"strings"
)

// ValidateVideoTaskState 在读取上游任务状态时校验「任务身份」，并把常见的
// data 信封展开。上游把任务包一层 data 是常态；但一旦响应里带了任务 ID 且
// 与本地任务不一致，这笔状态/产物就不属于本地任务 —— 直接报错，绝不把别的
// 任务的视频取回来当成自己的结果（参照上游 v1.7.22 的判据）。
//
// 不返回任务 ID 的上游依旧支持：只有「字段存在且非空且不相等」才算不一致。
func ValidateVideoTaskState(taskID string, state map[string]interface{}) (map[string]interface{}, error) {
	expected := strings.TrimSpace(taskID)
	for depth := 0; depth < 8; depth++ {
		if state == nil {
			return state, nil
		}
		for _, field := range []string{"id", "task_id", "taskId"} {
			if id := strings.TrimSpace(stringField(state, field)); id != "" && expected != "" && id != expected {
				return nil, errors.New("上游返回的任务 ID 与原视频任务不一致")
			}
		}
		nested, ok := state["data"].(map[string]interface{})
		if !ok {
			return state, nil
		}
		state = nested
	}
	return state, nil
}

// VideoTaskSucceeded 统一各家上游对「成功」的写法（completed / succeeded /
// success / done）。以前每个轮询点各写一遍，写法不同就会把已生成的结果
// 当成"还在跑"，一直转圈直到超时。
func VideoTaskSucceeded(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "succeeded", "success", "done":
		return true
	default:
		return false
	}
}

// logVideoRequestPlan 记录「这次视频请求按哪条分支、什么形状发出」的关键判据。
//
// 2026-10-15 20:51 出现过一次形状异常的 400（全库唯一一条 multipart
// input_reference[] 形状，其余都是 metadata.content[]），当时没有任何日志能
// 说明它为什么走了那条分支，只能靠猜。这行日志让下次一眼可查：
// branch / interfaceType / apiFormat / beefAPI / 分辨率 / 时长 / 参考素材数量。
func logVideoRequestPlan(ctx context.Context, input Input) {
	config := input.Config
	iface := strings.TrimSpace(config.InterfaceType)
	beefAPI := IsBeefAPIVideoConfig(ctx, config)
	branch := "legacy-multipart"
	switch {
	case beefAPI && (IsSeedanceVideoConfig(config) || IsBeefAPIH3Model(config.Model) || isBeefAPIFlatFrameVideo(config.Model)):
		branch = "beefapi-seedance"
	default:
		if _, ok := DeclarativeProtocolAdapterForContext(ctx, iface); ok {
			branch = "declarative-adapter"
		} else if IsArkPlanVideoConfig(config) {
			branch = "ark-agent-plan"
		} else if IsSeedanceVideoConfig(config) {
			branch = "seedance"
		} else if IsGrokVideoConfig(config) {
			branch = "grok"
		}
	}
	log.Printf("[video-plan] task=%s model=%s iface=%s apiFormat=%s branch=%s beefAPI=%t vquality=%q seconds=%q size=%q images=%d videos=%d audios=%d operation=%q",
		TaskExecutionID(ctx), config.Model, iface, config.APIFormat, branch, beefAPI,
		config.VQuality, config.VideoSeconds, config.Size,
		len(input.ReferenceImages), len(input.ReferenceVideos), len(input.ReferenceAudios),
		metadataString(input.Metadata, "videoEditOperation"))
}
