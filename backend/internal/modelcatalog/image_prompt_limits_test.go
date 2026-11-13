package modelcatalog

import (
	"strings"
	"testing"
)

func TestValidateImageTaskEnforcesZhenZhenPromptLength(t *testing.T) {
	profile := DefaultImageCapabilityConfig("newapi-image", "zhenzhen-image-g-v2.5-lowprice")
	base := TaskInput{
		Prompt: "您好",
		Config: TaskConfig{InterfaceType: "newapi-image", Model: "zhenzhen-image-g-v2.5-lowprice", Size: "1:1", Quality: "1k", Count: "1"},
	}
	if err := ValidateImageTask(profile, base); err == nil {
		t.Fatal("2-character prompt should be rejected")
	}
	base.Prompt = "您好请生成"
	if err := ValidateImageTask(profile, base); err != nil {
		t.Fatalf("5-character prompt rejected: %v", err)
	}
	base.Prompt = strings.Repeat("测", 5001)
	if err := ValidateImageTask(profile, base); err == nil {
		t.Fatal("5001-character prompt should be rejected")
	}
}
