package app

import (
	"fmt"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/plugins"
)

type PluginReleaseView = plugins.ReleaseView

func (s *Service) releaseDomain() *plugins.ReleaseService {
	if s == nil || s.pluginRuntime == nil || s.pluginRuntime.Runtime == nil || s.repo == nil {
		return nil
	}
	return plugins.NewReleaseService(s.pluginRuntime.Runtime, plugins.NewRepositoryPublicationStore(s.repo))
}

func (s *Service) UploadPluginReleaseForAdmin(actor *model.User, data []byte, fileName string, releaseNotes string) (PluginReleaseView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PluginReleaseView{}, err
	}
	service := s.releaseDomain()
	if service == nil {
		return PluginReleaseView{}, fmt.Errorf("插件发布服务未初始化")
	}
	view, err := service.Upload(actor.ID, data, plugins.UploadReleaseInput{ReleaseNotes: releaseNotes})
	if err != nil {
		return PluginReleaseView{}, err
	}
	if err := s.appendAdminAudit(actor, "plugin.release.upload", "plugin_release", view.Release.ID, "上传官方插件版本", map[string]any{
		"pluginId": view.Release.PluginID, "version": view.Release.Version, "packageSha256": view.Release.PackageSHA256, "fileName": fileName,
	}); err != nil {
		return PluginReleaseView{}, err
	}
	return view, nil
}

func (s *Service) PluginReleasesForAdmin(actor *model.User, pluginID string) ([]model.PluginRelease, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	service := s.releaseDomain()
	if service == nil {
		return nil, fmt.Errorf("插件发布服务未初始化")
	}
	return service.List(pluginID)
}

func (s *Service) PluginReleaseForAdmin(actor *model.User, releaseID string) (PluginReleaseView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PluginReleaseView{}, err
	}
	service := s.releaseDomain()
	if service == nil {
		return PluginReleaseView{}, fmt.Errorf("插件发布服务未初始化")
	}
	return service.Get(releaseID)
}

func (s *Service) PluginReleasePackageForAdmin(actor *model.User, releaseID string) ([]byte, *model.PluginRelease, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, nil, err
	}
	service := s.releaseDomain()
	if service == nil {
		return nil, nil, fmt.Errorf("插件发布服务未初始化")
	}
	return service.Package(releaseID)
}

func (s *Service) SubmitPluginReleaseForAdmin(actor *model.User, releaseID string) (PluginReleaseView, error) {
	return s.transitionPluginReleaseForAdmin(actor, releaseID, "plugin.release.submit", "提交官方插件版本审核", func(service *plugins.ReleaseService) (PluginReleaseView, error) {
		return service.SubmitReview(actor.ID, releaseID)
	})
}

func (s *Service) ApprovePluginReleaseForAdmin(actor *model.User, releaseID string, notes string) (PluginReleaseView, error) {
	return s.transitionPluginReleaseForAdmin(actor, releaseID, "plugin.release.approve", "审核通过官方插件版本", func(service *plugins.ReleaseService) (PluginReleaseView, error) {
		return service.Approve(actor.ID, releaseID, notes)
	})
}

func (s *Service) RejectPluginReleaseForAdmin(actor *model.User, releaseID string, notes string) (PluginReleaseView, error) {
	return s.transitionPluginReleaseForAdmin(actor, releaseID, "plugin.release.reject", "驳回官方插件版本", func(service *plugins.ReleaseService) (PluginReleaseView, error) {
		return service.Reject(actor.ID, releaseID, notes)
	})
}

func (s *Service) PublishPluginReleaseForAdmin(actor *model.User, releaseID string) (PluginReleaseView, error) {
	return s.transitionPluginReleaseForAdmin(actor, releaseID, "plugin.release.publish", "发布官方插件版本", func(service *plugins.ReleaseService) (PluginReleaseView, error) {
		return service.Publish(actor.ID, releaseID)
	})
}

func (s *Service) transitionPluginReleaseForAdmin(actor *model.User, releaseID string, action string, summary string, transition func(*plugins.ReleaseService) (PluginReleaseView, error)) (PluginReleaseView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PluginReleaseView{}, err
	}
	service := s.releaseDomain()
	if service == nil {
		return PluginReleaseView{}, fmt.Errorf("插件发布服务未初始化")
	}
	view, err := transition(service)
	if err != nil {
		return PluginReleaseView{}, err
	}
	if err := s.appendAdminAudit(actor, action, "plugin_release", view.Release.ID, summary, map[string]any{
		"pluginId": view.Release.PluginID, "version": view.Release.Version, "reviewStatus": view.Release.ReviewStatus,
	}); err != nil {
		return PluginReleaseView{}, err
	}
	return view, nil
}
