package skills

import "testing"

func TestLocalSkillSourceIsUnavailableForHostedRuntime(t *testing.T) {
	service := New(nil, "", nil)
	source, err := service.LocalSkillSource()
	if err != nil {
		t.Fatal(err)
	}
	if source.Available || source.Enabled {
		t.Fatalf("hosted source = %#v, want unavailable", source)
	}
	if source.Directory != "" || source.Reason == "" {
		t.Fatalf("hosted source = %#v, want empty directory and explanation", source)
	}
	if _, err := service.SetLocalSkillSource(true); err == nil {
		t.Fatal("hosted runtime accepted local skill source changes")
	}
}
