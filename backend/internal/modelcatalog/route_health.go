package modelcatalog

import (
	"fmt"
	"time"

	"infinite-canvas/backend/internal/model"
)

func routeHealthKeys(route CachedLogicalRoute) []string {
	return []string{"channel:" + route.ChannelModel.ChannelID, "channel-model:" + route.ChannelModel.ID, "route:" + route.Route.ID}
}

func (r *Router) LogicalRouteBlocked(route CachedLogicalRoute) bool {
	if r == nil {
		return false
	}
	now := r.clock()
	keys := routeHealthKeys(route)
	r.healthMu.Lock()
	for _, key := range keys {
		until, exists := r.healthBlocked[key]
		if !exists {
			continue
		}
		if !until.After(now) {
			delete(r.healthBlocked, key)
			continue
		}
		r.healthMu.Unlock()
		return true
	}
	r.healthMu.Unlock()
	return false
}

func (r *Router) BlockLogicalRouteForFailure(attempt *model.RouteAttempt, info FailureInfo) {
	if r == nil || attempt == nil {
		return
	}
	key := ""
	duration := time.Duration(0)
	if attempt.FailureCode == "upstream_401" || attempt.FailureCode == "upstream_403" {
		key, duration = "channel:"+attempt.ChannelID, 10*time.Minute
	} else if attempt.FailureCode == "upstream_404" {
		key, duration = "channel-model:"+attempt.ChannelModelID, 10*time.Minute
	} else if attempt.FailureCode == "upstream_429" {
		key, duration = "channel:"+attempt.ChannelID, 30*time.Second
		if info.RetryAfter > 0 {
			duration = info.RetryAfter
		}
	}
	if key == "" || duration <= 0 {
		return
	}
	until := r.clock().Add(duration)
	r.healthMu.Lock()
	r.healthBlocked[key] = until
	r.healthMu.Unlock()
}

func RouteFailureCode(info FailureInfo) string {
	if info.SlotCode != "" {
		return info.SlotCode
	}
	if info.StatusCode > 0 {
		return fmt.Sprintf("upstream_%d", info.StatusCode)
	}
	return "submission_unknown"
}

func SafeRouteRejection(info FailureInfo) bool {
	if info.ImageRecovery {
		return false
	}
	if info.SlotCode != "" {
		return true
	}
	switch info.StatusCode {
	// 这些状态码代表上游明确拒绝了这次请求（没有创建任务），重试是安全的；
	// 400 尤其重要：Seedream 之类的参数校验失败会回 400，若归为「提交结果未知」，
	// 用户会被告知「上游任务可能仍在执行，不要重试」，实际根本没有任务。
	case 400, 401, 402, 403, 404, 405, 406, 413, 415, 422, 429:
		return true
	}
	return false
}
