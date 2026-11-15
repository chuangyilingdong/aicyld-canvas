package handler

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"

	localproject "infinite-canvas/backend/internal/project"
)

func TestSmartFilmOpenAPIContainsMountedOperations(t *testing.T) {
	var spec map[string]any
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	paths, ok := spec["paths"].(map[string]any)
	if !ok {
		t.Fatal("OpenAPI paths missing")
	}
	expected := map[string][]string{
		"/smart-film-batches":                                                       {"get", "post"},
		"/smart-film-batches/{batchId}":                                             {"get", "delete"},
		"/smart-film-batches/{batchId}/budget":                                      {"patch"},
		"/smart-film-batches/{batchId}/production-config":                           {"patch"},
		"/smart-film-batches/{batchId}/costs":                                       {"get"},
		"/smart-film-batches/{batchId}/scripts":                                     {"put"},
		"/smart-film-batches/{batchId}/recover-scripts":                             {"post"},
		"/smart-film-batches/{batchId}/scripts/{scriptId}":                          {"patch", "delete"},
		"/smart-film-batches/{batchId}/confirm":                                     {"post"},
		"/smart-film-batches/{batchId}/production-runs/{runId}":                     {"patch"},
		"/smart-film-batches/{batchId}/production-runs/{runId}/start":               {"post"},
		"/projects/{id}/production-run":                                              {"get"},
		"/smart-film-batches/{batchId}/control":                                     {"patch"},
		"/smart-film-batches/{batchId}/production-runs/{runId}/control":             {"patch"},
		"/projects/{id}/asset-candidates/{candidateId}":                             {"patch"},
		"/projects/{id}/asset-candidates/{candidateId}/preview":                     {"patch"},
		"/projects/{id}/asset-candidates/{candidateId}/previews/{previewId}/select": {"post"},
		"/projects/{id}/asset-candidates/{candidateId}/previews/{previewId}":        {"delete"},
	}
	for path, methods := range expected {
		operations, ok := paths[path].(map[string]any)
		if !ok {
			t.Errorf("OpenAPI path missing: %s", path)
			continue
		}
		for _, method := range methods {
			if _, ok := operations[method].(map[string]any); !ok {
				t.Errorf("OpenAPI operation missing: %s %s", method, path)
			}
		}
	}
}

func TestOpenAPIReferencesResolve(t *testing.T) {
	var spec any
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	var walk func(any)
	walk = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			if ref, ok := typed["$ref"].(string); ok {
				if !strings.HasPrefix(ref, "#/") || resolveOpenAPIReference(spec, ref) == nil {
					t.Errorf("unresolved OpenAPI reference: %s", ref)
				}
			}
			for _, child := range typed {
				walk(child)
			}
		case []any:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(spec)
}

func TestSmartFilmRoutesRemainInternalUntilExternalApproval(t *testing.T) {
	catalog := NewBusinessCatalog(gin.RoutesInfo{
		{Method: "GET", Path: "/api/smart-film-batches"},
		{Method: "POST", Path: "/api/smart-film-batches/:id/confirm"},
		{Method: "PATCH", Path: "/api/smart-film-batches/:id/production-runs/:runId/control"},
	})
	if len(catalog.Tools) != 0 {
		t.Fatalf("smart-film routes exposed without an external approval model: %+v", catalog.Tools)
	}
}

func TestSmartFilmStatusContractsMatchOpenAPI(t *testing.T) {
	var spec map[string]any
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	components, _ := spec["components"].(map[string]any)
	schemas, _ := components["schemas"].(map[string]any)
	checks := []struct {
		schema   string
		property string
		want     []string
	}{
		{"SmartFilmBatch", "status", []string{"draft", "confirmed", "partially_confirmed"}},
		{"SmartFilmScript", "status", []string{"draft", "project_created", "assets_extracted", "storyboard_ready", "needs_attention", "failed"}},
		{"SmartFilmProductionRun", "status", []string{"pending", "ready", "needs_attention", "failed", "skipped", "archived"}},
		{"SmartFilmProductionRun", "controlStatus", []string{"active", "paused", "skipped"}},
		{"SmartFilmProductionRun", "assetStatus", []string{"pending", "waiting", "queued", "running", "ready", "confirmed", "needs_attention"}},
		{"SmartFilmProductionRun", "storyboardStatus", []string{"pending", "waiting", "queued", "running", "ready", "needs_attention"}},
	}
	if localproject.SmartFilmProductionRunStatusArchived != "archived" || localproject.SmartFilmProductionStepArchived != "archived" {
		t.Fatal("archived lifecycle status drifted from the canonical name")
	}
	for _, check := range checks {
		schema, _ := schemas[check.schema].(map[string]any)
		properties, _ := schema["properties"].(map[string]any)
		field, _ := properties[check.property].(map[string]any)
		raw, _ := field["enum"].([]any)
		got := make([]string, 0, len(raw))
		for _, value := range raw {
			if text, ok := value.(string); ok {
				got = append(got, text)
			}
		}
		sort.Strings(got)
		want := append([]string(nil), check.want...)
		sort.Strings(want)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s.%s enum = %v, want %v", check.schema, check.property, got, want)
		}
	}
}

func resolveOpenAPIReference(root any, ref string) any {
	var current any = root
	for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[part]
	}
	return current
}
