import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
