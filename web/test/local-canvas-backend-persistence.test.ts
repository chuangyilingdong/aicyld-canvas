import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repository = readFileSync(resolve(import.meta.dir, "../src/services/local-workspace-repository.ts"), "utf8");
const lifecycle = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-project-lifecycle.ts"), "utf8");
const operations = readFileSync(resolve(import.meta.dir, "../src/services/api/operations.ts"), "utf8");

test("desktop local canvas creation starts durable sync without waiting for cache flush", () => {
    const begin = repository.indexOf("export function beginLocalCanvasProject(");
    const sync = repository.indexOf("const saved = syncLocalCanvasProject(id);", begin);
    const returned = repository.indexOf("return { id, saved };", sync);
    expect(begin).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(begin);
    expect(returned).toBeGreaterThan(sync);
    expect(repository.slice(begin, sync)).not.toContain("await flushCanvasStorePersistence();");
    expect(repository).toContain("const { id, saved } = beginLocalCanvasProject(title, projectId, initialContent, workspaceProjectId, starterMode);");
    expect(repository).toContain("await saved;");
});

test("local and hosted canvas edits schedule and explicit saves await backend persistence", () => {
    expect(lifecycle).toContain("if (hasUnconfirmedCanvasEdits(projectId)) scheduleLocalCanvasBackendSync(projectId);");
    expect(lifecycle).toContain("scheduleLocalCanvasBackendSync(projectId);");
    expect(lifecycle).toContain("await syncLocalCanvasProjectToBackend(projectId);");
    expect(repository).toContain("await flushCanvasStorePersistence();\n        await syncLocalCanvasProject(id);");
    expect(repository).toContain("const backendSaveTails = new Map<string, Promise<void>>()");
    expect(repository).toContain("commitCanvasDocument");
    expect(operations).toContain("ensureAgentUiSession");
    expect(operations).toContain("X-Beeftv-Ui-Session");
    expect(operations).toContain("await ensureAgentUiSession()");
});

test("canvas save summary never replaces the full node document", () => {
    expect(repository).toContain("type CanvasSaveSummary = Pick<CanvasProject");
    expect(repository).not.toContain("current.updatedAt === project.updatedAt ? saved");
    expect(repository).toContain("revision: saved.revision");
});

test("local canvas deletion removes the canonical backend record", () => {
    expect(repository).toContain("await http.delete(`/canvas-projects/${encodeURIComponent(id)}`)");
});
