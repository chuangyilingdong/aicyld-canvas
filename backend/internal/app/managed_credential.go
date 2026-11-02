package app

import (
	"strings"

	"infinite-canvas/backend/internal/beefapi"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/platformchannels"
	"infinite-canvas/backend/internal/workspace"
)

const managedBeefAPIRef = beefapi.CredentialRef

func (s *Service) SetBeefAPI(connection *beefapi.Service) {
	if s != nil {
		s.beefAPI = connection
	}
}

func (s *Service) BeefAPI() *beefapi.Service {
	if s == nil {
		return nil
	}
	return s.beefAPI
}

func (s *Service) resolveManagedBeefAPISecrets(input map[string]any) (map[string]any, error) {
	return generation.ResolveManagedBeefAPISecrets(input, s.beefAPI, s.ReadLocalModelConfig)
}

func (s *Service) lookupBeefAPICredential() (apiKey, baseURL, accountID, tokenID string, err error) {
	return generation.LookupBeefAPICredential(s.beefAPI, s.ReadLocalModelConfig)
}

func (s *Service) resolveChannelModelsRequest(input *ChannelModelsRequest) error {
	return generation.ResolveChannelModelsRequest(input, s.beefAPI, s.ReadLocalModelConfig)
}

func (s *Service) ResolveCustomRelayAPIKey(targetURL, incoming string) (string, error) {
	return s.resolveCustomRelayKey(targetURL, incoming)
}

func (s *Service) resolveCustomRelayKey(targetURL, incoming string) (string, error) {
	if key, ok := s.resolvePlatformChannelKey(targetURL, incoming); ok {
		return key, nil
	}
	return generation.ResolveCustomRelayKey(targetURL, incoming, s.beefAPI, s.ReadLocalModelConfig)
}

// resolvePlatformChannelKey replaces only the browser placeholder, never a real
// user-supplied key. Matching is limited to the configured scheme and host.
func (s *Service) resolvePlatformChannelKey(targetURL, incoming string) (string, bool) {
	if s == nil {
		return "", false
	}
	provided := strings.TrimSpace(incoming)
	if provided != "" && provided != platformchannels.PlaceholderSecret && provided != workspace.RedactedSecret {
		return "", false
	}
	store, err := platformchannels.New(s.dataDir)
	if err != nil || !store.Configured() {
		return "", false
	}
	return store.ResolveAPIKey(targetURL)
}

func (s *Service) noteBeefAPIProviderError(message string) {
	if s != nil {
		generation.NoteBeefAPIProviderError(s.beefAPI, message)
	}
}
