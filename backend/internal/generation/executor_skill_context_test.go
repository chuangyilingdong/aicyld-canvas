package generation

import (
	"strings"
	"testing"
)

func TestPrependSkillContextKeepsSingleSkillAndPlatformContract(t *testing.T) {
	prompt := prependSkillContext("平台剧本任务", "唯一技能包：剧本规范")
	if !strings.Contains(prompt, "唯一技能包：剧本规范") || !strings.Contains(prompt, "【平台阶段任务】\n平台剧本任务") {
		t.Fatalf("prompt = %s", prompt)
	}
	if strings.Count(prompt, "唯一技能包") != 1 {
		t.Fatalf("skill context duplicated: %s", prompt)
	}
	if prompt := prependSkillContext("任务", ""); prompt != "任务" {
		t.Fatalf("empty skill context changed prompt: %q", prompt)
	}
}
