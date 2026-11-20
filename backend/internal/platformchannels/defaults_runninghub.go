package platformchannels

import (
	_ "embed"
	"encoding/json"
)

// runninghub-default-channels.json is generated from the RunningHub public
// model registry and pricing snapshot on 2026-11-19. It contains no secrets.
//
//go:embed runninghub-default-channels.json
var runningHubDefaultChannelsJSON []byte

// Defaults returns the active platform channels. The previous ZhenZhen channel
// is intentionally not included.
func Defaults() []Channel {
	var channels []Channel
	if err := json.Unmarshal(runningHubDefaultChannelsJSON, &channels); err != nil {
		panic("invalid embedded RunningHub default channels: " + err.Error())
	}
	for channelIndex := range channels {
		for profileIndex := range channels[channelIndex].ModelProfiles {
			channels[channelIndex].ModelProfiles[profileIndex] = repairKnownProfile(channels[channelIndex].ModelProfiles[profileIndex])
		}
	}
	return channels
}
