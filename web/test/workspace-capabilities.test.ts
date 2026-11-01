import { afterEach, expect, test } from "bun:test";

import {
    resetWorkspaceMode,
    setWorkspaceCapabilitySnapshot,
    setWorkspaceProfile,
    workspaceCapabilities,
} from "../src/services/workspace-mode";

afterEach(() => resetWorkspaceMode());

test("workspace capabilities expose only the local runtime contract", () => {
    setWorkspaceCapabilitySnapshot({
        contractVersion: 1,
        profile: "local",
        capabilities: {
            localAssets: true,
            providerCalls: true,
        },
    });

    expect(workspaceCapabilities()).toEqual({
        local: true,
        localAssets: true,
        providerCalls: true,
    });
});

test("workspace capabilities use safe local defaults before bootstrap", () => {
    expect(workspaceCapabilities()).toEqual({
        local: true,
        localAssets: true,
        providerCalls: true,
    });
});

test("workspace capabilities follow a hosted bootstrap", () => {
    setWorkspaceProfile("hosted");
    setWorkspaceCapabilitySnapshot({
        contractVersion: 1,
        profile: "hosted",
        capabilities: { localAssets: false, providerCalls: true },
    });

    expect(workspaceCapabilities()).toEqual({ local: false, localAssets: false, providerCalls: true });
});
