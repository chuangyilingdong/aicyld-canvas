package operations

import (
	"encoding/json"
	"infinite-canvas/backend/internal/skills"
)

type SkillResources interface {
	AgentSkillVersion(string, skills.Pin) (*skills.AgentResource, error)
	AgentSkillFile(string, skills.Pin, string) (*skills.AgentFile, error)
}

type SkillDraft interface {
	DraftSkill(string, skills.SkillMutationRequest) (*skills.SkillItem, error)
}

func registerSkillOps(r *Registry) {
	for _, id := range []string{"skill.get", "skill.file"} {
		operation := id
		r.Register(Op{AssistantCanvas: true, ID: operation, Summary: "读取当前对话选定技能的固定版本正文或包内辅助文本；不执行脚本", ReadOnly: true, Scope: ScopeCanvas,
			Params: json.RawMessage(`{"type":"object","properties":{"skillId":{"type":"string"},"versionId":{"type":"string"},"contentHash":{"type":"string"},"path":{"type":"string"}},"required":["skillId","versionId","contentHash"]}`),
			Handler: func(ctx *Context, raw json.RawMessage) (any, error) {
				var args struct {
					skills.Pin
					Path string `json:"path"`
				}
				if err := decodeParams(raw, &args); err != nil {
					return nil, err
				}
				port, ok := ctx.Domain.(SkillResources)
				if !ok {
					return nil, Unsupported("skill_unavailable", "当前工作区无法读取技能")
				}
				if operation == "skill.get" {
					if args.Path != "" {
						return nil, InvalidArg("unexpected_path", "正文读取不接收文件路径")
					}
					result, err := port.AgentSkillVersion(ctx.UserID, args.Pin)
					return result, mapDomainError(err)
				}
				if args.Path == "" {
					return nil, InvalidArg("skill_path_required", "辅助文件读取需要包内路径")
				}
				result, err := port.AgentSkillFile(ctx.UserID, args.Pin, args.Path)
				return result, mapDomainError(err)
			}})
	}
}

func registerSkillDraftOp(r *Registry) {
	r.Register(Op{ID: "skill.draft", AssistantCanvas: true, Scope: ScopeCanvas, Summary: "把当前画布的创作方法保存为私人技能草稿，不上传、不送审", Params: json.RawMessage(`{"type":"object","properties":{"canvasId":{"type":"string"},"name":{"type":"string"},"description":{"type":"string"},"instruction":{"type":"string"}},"required":["canvasId","name","description","instruction"],"additionalProperties":false}`), Handler: func(ctx *Context, raw json.RawMessage) (any, error) {
		var args struct {
			CanvasID    string `json:"canvasId"`
			Name        string `json:"name"`
			Description string `json:"description"`
			Instruction string `json:"instruction"`
		}
		if err := decodeParams(raw, &args); err != nil {
			return nil, err
		}
		port, ok := ctx.Domain.(SkillDraft)
		if !ok {
			return nil, Unsupported("skill_unavailable", "当前工作区无法保存技能草稿")
		}
		if _, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID); err != nil {
			return nil, mapDomainError(err)
		}
		value, err := port.DraftSkill(ctx.UserID, skills.SkillMutationRequest{SkillName: args.Name, Description: args.Description, Instruction: args.Instruction, Tag: "others", IsPrivate: true})
		return value, mapDomainError(err)
	}})
}
