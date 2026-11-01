package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

func (s *Service) protocolRegistry() *protocol.Registry {
	registry := s.pluginDomain().Registry()
	if registry == nil {
		registry = loadOfficialFallbackRegistry()
	}
	return registryWithHostBuiltins(registry)
}

// registryWithHostBuiltins keeps host-backed protocols available when the
// installer registry is populated only from declarative packages. Package
// adapters win; builtins fill protocols that have no packaged replacement.
func registryWithHostBuiltins(base *protocol.Registry) *protocol.Registry {
	if base == nil {
		return protocol.Builtins()
	}
	adapters := make([]protocol.Adapter, 0)
	for _, metadata := range base.List("", "", true) {
		if adapter, ok := base.Get(metadata.ID); ok {
			adapters = append(adapters, adapter)
		}
	}
	missing := false
	for _, metadata := range protocol.Builtins().List("", "", true) {
		if _, exists := base.Resolve(metadata.ID); exists {
			continue
		}
		if adapter, ok := protocol.Builtins().Get(metadata.ID); ok {
			adapters = append(adapters, adapter)
			missing = true
		}
	}
	if !missing {
		return base
	}
	merged, err := protocol.NewRegistry(adapters...)
	if err != nil {
		return base
	}
	return merged
}

func (s *Service) protocolMetadata(id string) (protocol.Metadata, bool) {
	adapter, ok := s.protocolRegistry().Resolve(strings.TrimSpace(id))
	if !ok {
		return protocol.Metadata{}, false
	}
	return adapter.Metadata(), true
}

func (s *Service) channelProtocolMetadata(id string) (protocol.Metadata, bool) {
	return s.protocolMetadata(id)
}

func (s *Service) canonicalProtocolID(id string) (string, bool) {
	adapter, ok := s.protocolRegistry().Resolve(strings.TrimSpace(id))
	if !ok {
		return "", false
	}
	return adapter.Metadata().ID, true
}

func (s *Service) protocolIsSelectable(id string) bool {
	metadata, ok := s.channelProtocolMetadata(id)
	return ok && metadata.Enabled && metadata.UnavailableReason == ""
}

func (s *Service) InstallPlugin(data []byte, fileName string) (PluginView, error) {
	return s.pluginDomain().Install(data, fileName)
}

func (s *Service) InstallPluginForAdmin(actor *model.User, data []byte, fileName string) (PluginView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PluginView{}, err
	}
	plugin, err := s.pluginDomain().InstallUploaded(actor.ID, data, fileName)
	if err != nil {
		return PluginView{}, mapPluginAccessError(err)
	}
	if err := s.appendAdminAudit(actor, "plugin.install", "plugin", plugin.Manifest.ID, "安装自定义插件", map[string]any{"fileName": fileName, "sha256": plugin.SHA256}); err != nil {
		return PluginView{}, err
	}
	return plugin, nil
}

func (s *Service) SetPluginEnabled(id string, enabled bool) (PluginView, error) {
	return s.pluginDomain().SetEnabled(id, enabled)
}

func (s *Service) UninstallPlugin(id string) error {
	return s.pluginDomain().Uninstall(id)
}

func (s *Service) UninstallPluginForAdmin(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if err := s.pluginDomain().UninstallUploaded(id); err != nil {
		return mapPluginAccessError(err)
	}
	return s.appendAdminAudit(actor, "plugin.uninstall", "plugin", id, "卸载自定义插件", nil)
}
