package protocol

import "strings"

// NormalizeSeedanceTaskOptions applies only explicit task intent, never guesses
// edit/extend intent from free-form prompts. See the official Seedance 2.5 guide.
func NormalizeSeedanceTaskOptions(r GenerationRequest) GenerationRequest {
	m := strings.ToLower(r.Model)
	if !(strings.HasSuffix(m, "seedance-2.5") || strings.Contains(m, "seedance-2.5-") || strings.HasSuffix(m, "seedance-2-5") || strings.Contains(m, "seedance-2-5-")) {
		return r
	}
	locked := false
	for _, media := range r.Images {
		locked = locked || media.Role == "first_frame" || media.Role == "last_frame"
	}
	if len(r.Videos) > 0 {
		// 上游把「带参考视频」的 2.5 请求一律按视频编辑处理：ratio 必须是 adaptive、
		// duration 必须是 -1（时长由原视频决定），否则回 400 invalid_video_edit_parameters
		// （"Seedance 2.5 video editing requires ratio=adaptive and duration=-1"）。
		// 真钱实测：图+视频+音频的全能参考若沿用用户选的 16:9 / 5 秒即被上游拒绝。
		locked = true
		// extend 例外：那里的 duration 表达「延长多少秒」，由上游语义决定，保留用户选择。
		if r.Operation != "extend" {
			r.Duration = -1
		}
	}
	if locked {
		r.AspectRatio = "adaptive"
	}
	r.Output.AspectRatio, r.Output.Duration = r.AspectRatio, r.Duration
	return r
}

// SeedanceOmniTaskType preserves explicit operation intent at the wire boundary.
func SeedanceOmniTaskType(r GenerationRequest) string {
	m := strings.ToLower(r.Model)
	if !(strings.HasSuffix(m, "seedance-2.5") || strings.Contains(m, "seedance-2.5-") || strings.HasSuffix(m, "seedance-2-5") || strings.Contains(m, "seedance-2-5-")) {
		return ""
	}
	switch r.Operation {
	case "reference_to_video":
		return "reference"
	case "extend":
		if len(r.Videos) > 0 {
			return "extend"
		}
	case "inpaint", "replace_element", "style_transfer":
		if len(r.Videos) > 0 {
			return "edit"
		}
	}
	return ""
}
