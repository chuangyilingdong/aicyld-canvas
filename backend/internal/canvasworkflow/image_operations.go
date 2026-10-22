package canvasworkflow

import (
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/mediaupscale"
)

func ImageWorkflowOperations() []Operation {
	out := []Operation{
		{ID: "image.select", Version: 1, Name: "选择图片结果", OutputType: "image", Inputs: []InputPort{{"images", "候选图片", "image", true, true}}},
		{ID: "image.describe", Version: 1, Name: "反推提示词", OutputType: "text", Inputs: []InputPort{{"image", "参考图片", "image", true, false}}, Fields: []Field{{Key: "modelOption", Label: "识图模型", Type: "select"}, {Key: "prompt", Label: "反推要求", Type: "textarea"}}},
	}
	models := mediaupscale.Models()
	for _, kind := range []string{"image", "video"} {
		options := []FieldOption{}
		resolutions := []FieldOption{}
		qualities := []FieldOption{}
		for _, model := range models {
			if model.MediaType != kind {
				continue
			}
			options = append(options, FieldOption{Label: model.Label, Value: model.ID})
			for _, value := range model.Resolutions {
				resolutions = append(resolutions, FieldOption{Label: value, Value: value})
			}
			for _, value := range model.Qualities {
				qualities = append(qualities, FieldOption{Label: value, Value: value})
			}
		}
		name := "AI超分"
		out = append(out, Operation{ID: kind + ".ai-upscale", Version: 1, Name: name, OutputType: kind,
			Inputs: []InputPort{{kind, map[string]string{"image": "图片", "video": "视频"}[kind], kind, true, false}},
			Fields: []Field{
				{Key: "channelId", Label: "超分渠道", Type: "select"},
				{Key: "model", Label: "超分模型", Type: "select", Options: options},
				{Key: "resolution", Label: "目标分辨率", Type: "select", Options: resolutions},
				{Key: "quality", Label: "质量", Type: "select", Options: qualities},
			},
		})
	}
	return out
}

func UpscaleRequest(n Node) (mediaupscale.Request, error) {
	model, _ := n.Config["model"].(string)
	channel, _ := n.Config["channelId"].(string)
	resolution, _ := n.Config["resolution"].(string)
	quality, _ := n.Config["quality"].(string)
	if strings.TrimSpace(channel) != "" && channel != "beefapi" {
		return mediaupscale.Request{}, fmt.Errorf("超分任务需要使用官方算力渠道")
	}
	request := mediaupscale.Request{Model: strings.TrimSpace(model), Resolution: resolution, Quality: quality}
	spec, ok := mediaupscale.FindModel(request.Model)
	if !ok {
		return mediaupscale.Request{}, fmt.Errorf("请选择超分模型")
	}
	if spec.MediaType != n.MediaType {
		return mediaupscale.Request{}, fmt.Errorf("当前超分模型与素材类型不匹配")
	}
	return request, nil
}
