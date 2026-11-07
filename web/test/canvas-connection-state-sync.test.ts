import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanupPendingGenerationConnections } from "../src/lib/canvas/canvas-generation-connection-cleanup";

test("reference validation consumes the same committed graph as the editor", () => {
    const prompt = readFileSync(new URL("../src/pages/canvas/canvas-project-node-prompt.tsx", import.meta.url), "utf8");
    expect(prompt).toContain("referenceNodes={nodes}");
    expect(prompt).toContain("referenceConnections={connections}");
    expect(prompt).not.toContain("referenceNodes={nodesRef.current}");
    expect(prompt).not.toContain("referenceConnections={connectionsRef.current}");
});

test("connection updates advance the ref synchronously before React commits", () => {
    const document = readFileSync(new URL("../src/pages/canvas/use-canvas-document-state.ts", import.meta.url), "utf8");
    expect(document).toContain("const setConnections = useCallback<Dispatch<SetStateAction<CanvasConnection[]>>>");
    expect(document).toContain("const next = typeof value === \"function\" ? value(connectionsRef.current) : value;");
    expect(document).toContain("connectionsRef.current = next;");
    expect(document).toContain("setCommittedConnections(next);");
});

test("video retry rebuilds missing references from current canvas connections", () => {
    const retry = readFileSync(new URL("../src/pages/canvas/use-canvas-generation-retry.ts", import.meta.url), "utf8");
    expect(retry).toContain("buildNodeGenerationInputs(node.id, nodesRef.current, connectionsRef.current)");
    expect(retry.indexOf("connectedVideoImages.length")).toBeLessThan(retry.indexOf("await resolveStoredReferenceImages(node.metadata?.references)"));
    expect(retry).toContain("connectedVideoImages.length\n                    ? connectedVideoImages");
});

test("save-conflict cleanup keeps the existing target's reference edges", () => {
    const connections = [
        { id: "ref-1", fromNodeId: "image-1", toNodeId: "video-target" },
        { id: "ref-2", fromNodeId: "image-2", toNodeId: "video-target" },
        { id: "temp", fromNodeId: "video-target", toNodeId: "temporary-output" },
    ];
    const cleaned = cleanupPendingGenerationConnections(connections, "video-target", ["video-target", "temporary-output"]);
    expect(cleaned.map((connection) => connection.id)).toEqual(["ref-1", "ref-2"]);
});
