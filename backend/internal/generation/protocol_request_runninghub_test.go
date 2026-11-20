package generation

import "testing"

func TestProtocolRequestCarriesRunningHubAudioLyrics(t *testing.T) {
	request := ProtocolRequestFromInput(Input{
		Mode:   "audio",
		Prompt: "billing audit",
		Config: Config{
			Model:       "rh-mureka-v9-song",
			AudioLyrics: "RunningHub billing audit",
			AudioSpeed:  "1",
			Count:       "1",
		},
	})
	if got := request.Extra["audioLyrics"]; got != "RunningHub billing audit" {
		t.Fatalf("audioLyrics = %#v", got)
	}
}
