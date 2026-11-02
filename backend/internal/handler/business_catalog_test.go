package handler

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBusinessCatalogProjectsQueriesAndTrustedTaskFields(t *testing.T) {
	catalog := NewBusinessCatalog(gin.RoutesInfo{
		{Method: "GET", Path: "/api/projects"},
		{Method: "GET", Path: "/api/projects/:id/chapter-apply-receipts"},
		{Method: "POST", Path: "/api/tasks"},
		{Method: "GET", Path: "/api/assistant/runtime/turns/:id"},
	})
	if len(catalog.Tools) != 3 {
		t.Fatalf("sensitive route discovered: %#v", catalog.Tools)
	}
	for _, tool := range catalog.Tools {
		props := tool.Params["properties"].(map[string]any)
		if tool.Path == "/projects" {
			query := props["query"].(map[string]any)["properties"].(map[string]any)
			if query["pageSize"].(map[string]any)["default"] != "50" {
				t.Fatal("actual handler pagination default absent", query)
			}
		}
		if tool.Path == "/projects/:id/chapter-apply-receipts" {
			query := props["query"].(map[string]any)["properties"].(map[string]any)
			field := query["taskIds"].(map[string]any)
			if field["description"] == "" || field["x-value-schema"] == nil {
				t.Fatal("OpenAPI query metadata not projected", query)
			}
		}
		if tool.Path == "/tasks" {
			raw, _ := json.Marshal(props["body"])
			if strings.Contains(strings.ToLower(string(raw)), "admission") || !tool.SubmitsGeneration || tool.Cost != "selected-channel" {
				t.Fatal("trusted admission exposed or cost missing", string(raw), tool)
			}
		}
	}
	if _, ok := catalog.Match("GET", "/api/projects/../chapter-apply-receipts"); ok {
		t.Fatal("unsafe path accepted")
	}
}

func TestBusinessCatalogOutboundPostsRequireWriteClient(t *testing.T) {
	routes := gin.RoutesInfo{}
	for _, path := range []string{"/ai/models", "/runninghub/workflow-info", "/runninghub/app-info"} {
		routes = append(routes, gin.RouteInfo{Method: "POST", Path: "/api" + path})
	}
	catalog := NewBusinessCatalog(routes)
	if len(catalog.Tools) != 3 {
		t.Fatal("outbound tools missing")
	}
	for _, tool := range catalog.Tools {
		if tool.ReadOnly {
			t.Fatal("outbound POST marked read-only", tool.Path)
		}
	}
}

func TestBusinessCatalogMarketReadsCannotReachPublishingConfirmation(t *testing.T) {
	routes := gin.RoutesInfo{{Method: "GET", Path: "/api/skills"}, {Method: "GET", Path: "/api/skills/:id"}, {Method: "GET", Path: "/api/skills/:id/file"}}
	public := []string{"/skills"}
	for _, path := range public {
		routes = append(routes, gin.RouteInfo{Method: "GET", Path: "/api" + path})
	}
	private := []struct{ method, path string }{
		{"GET", "/skills/review/submissions"},
		{"POST", "/skills/review/submissions/:submissionId/review"},
		{"POST", "/skills/:id/unpublish"},
		{"GET", "/skills/:id/submissions"},
		{"POST", "/skills/:id/submissions"},
		{"POST", "/skills/submissions/:submissionId/submit"},
	}
	for _, r := range private {
		routes = append(routes, gin.RouteInfo{Method: r.method, Path: "/api" + r.path})
	}
	c := NewBusinessCatalog(routes)
	if len(c.Tools) != 3 {
		t.Fatalf("publishing routes leaked: %+v", c.Tools)
	}
	for _, path := range []string{"/skills", "/skills/example", "/skills/example/file"} {
		for _, prefix := range []string{"", "/api"} {
			if tool, ok := c.Match("GET", prefix+path); !ok || !tool.ReadOnly {
				t.Fatalf("public read lost: %s%s", prefix, path)
			}
		}
	}
	for _, r := range private {
		for _, prefix := range []string{"", "/api"} {
			path := strings.ReplaceAll(strings.ReplaceAll(r.path, ":id", "forged-plan"), ":submissionId", "forged-submission")
			if _, ok := c.Match(r.method, prefix+path); ok {
				t.Fatalf("private route callable: %s %s%s", r.method, prefix, r.path)
			}
		}
	}
}
