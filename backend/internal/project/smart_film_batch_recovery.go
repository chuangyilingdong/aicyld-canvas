package project

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

// RecoverSmartFilmBatchScripts repairs the narrow failure window where a text
// task succeeds but the browser loses the final save request. The recovery is
// deterministic and only reads a succeeded task explicitly tagged for this batch.
func (s *Service) RecoverSmartFilmBatchScripts(userID, batchID string) (SmartFilmBatchView, error) {
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	scripts, err := s.smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	if len(scripts) > 0 {
		return s.smartFilmBatchResponse(*batch)
	}
	tasks, err := s.repo.RecentSucceededCanvasTextTasks(userID, 200)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	for _, task := range tasks {
		if !smartFilmScriptTaskMatchesBatch(task, batchID) {
			continue
		}
		inputs := parseRecoveredSmartFilmScripts(task)
		if len(inputs) == 0 {
			continue
		}
		return s.SaveSmartFilmBatchScripts(userID, batchID, SaveSmartFilmBatchScriptsRequest{
			ExpectedRevision: batch.Revision,
			Scripts:          inputs,
		})
	}
	return SmartFilmBatchView{}, kernel.NotFound("没有找到可恢复的剧本生成结果")
}

func smartFilmScriptTaskMatchesBatch(task model.Task, batchID string) bool {
	var input struct {
		Metadata struct {
			BatchID string `json:"batchId"`
			Source  string `json:"source"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
		return false
	}
	return input.Metadata.BatchID == batchID && input.Metadata.Source == "smart-film-batch-script"
}

func parseRecoveredSmartFilmScripts(task model.Task) []SmartFilmScriptInput {
	var result struct {
		Text string `json:"text"`
	}
	if json.Unmarshal([]byte(task.ResultJSON), &result) != nil {
		return nil
	}
	text := strings.TrimSpace(result.Text)
	if text == "" {
		return nil
	}
	candidates := []string{text}
	if start, end := strings.Index(text, "{"), strings.LastIndex(text, "}"); start >= 0 && end > start {
		candidates = append(candidates, text[start:end+1])
	}
	for _, candidate := range candidates {
		var payload struct {
			Scripts []struct {
				Title   string `json:"title"`
				Content string `json:"content"`
			} `json:"scripts"`
		}
		if json.Unmarshal([]byte(candidate), &payload) != nil {
			continue
		}
		inputs := make([]SmartFilmScriptInput, 0, len(payload.Scripts))
		for _, script := range payload.Scripts {
			title := strings.TrimSpace(script.Title)
			content := strings.TrimSpace(script.Content)
			if title == "" || content == "" {
				continue
			}
			inputs = append(inputs, SmartFilmScriptInput{Title: title, Content: content, TaskID: task.ID})
		}
		if len(inputs) > 0 {
			return inputs
		}
	}
	return nil
}
