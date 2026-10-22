import { mock } from "bun:test";
import { strict as assert } from "node:assert";

// Run in a separate process: deterministic model/network boundaries must not leak
// into the rest of the frontend suite. The real hook owns confirmation and dispatch.
(globalThis as any).window = globalThis;
const confirmations: { onOk: () => void }[] = [];
const dispatched: any[] = [];
const react = await import("react");
mock.module("react", () => ({ ...react, default: react.default, useCallback: (fn: any) => fn, useRef: (value: any) => ({ current: value }) }));
mock.module("antd", () => ({ App: { useApp: () => ({ modal: { confirm: (input: any) => confirmations.push(input) }, message: { error: (x: string) => { throw Error(x); }, info: () => {}, warning: () => {}, loading: () => {}, destroy: () => {} } }) } }));
const configStoreMock = {
    useEffectiveConfig: () => ({}),
    useConfigStore: Object.assign((select: any) => select({ isAiConfigReady: () => true }), {
        getState: () => ({}),
        setState: () => {},
        subscribe: () => () => {},
    }),
    resolveModelRequestConfig: () => ({}),
    isSystemProxyBaseUrl: () => false,
    buildApiUrl: (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
    resolveBackendApiUrl: (value: string) => value,
    systemProxyChannelId: () => "",
    MANAGED_BEEFAPI_CREDENTIAL_REF: "beefapi-enterprise",
    modelOptionName: (value: string) => String(value || "").split("::").pop() || "",
    modelDisplayName: (_config: unknown, value: string) => value,
    resolveModelChannel: () => ({}),
    logicalModelIDForConfig: () => "",
    modelMatchesCapability: () => false,
    configuredModelMatchesCapability: () => false,
    channelHasGenerationCredential: () => false,
    channelHasManagedBeefAPICredential: () => false,
    isBuiltinBeefAPIChannel: () => false,
    modelOptionsFromChannels: () => [],
    encodeChannelModel: (channelId: string, model: string) => `${channelId}::${model}`,
    decodeChannelModel: (value: string) => ({ channelId: String(value || "").split("::")[0] || "", model: String(value || "").split("::").pop() || "" }),
    isChannelModelValue: (value: string) => String(value || "").includes("::"),
    normalizeRunningHubCapability: (_value: unknown, fallback = "image") => fallback,
    normalizeRunningHubWorkflowKind: (value: unknown) => value === "app" ? "app" : "workflow",
    normalizeWorkflowFieldMappings: () => [],
    mergeWorkflowFieldMappings: () => [],
    PUBLIC_MODEL_CATALOG_ID: "managed",
    CONFIG_STORE_KEY: "open_ai_canvas:ai_config_store",
    defaultConfig: {},
    channelModelProfile: () => undefined,
    filterModelsByCapability: (models: string[]) => models,
    selectableModelsByCapability: () => [],
    effectiveConfigForCustomChannels: (config: unknown) => config,
    createModelChannel: (channel: Record<string, unknown> = {}) => ({ id: "", ...channel }),
    configWithoutCachedSecrets: (config: unknown) => config,
    normalizeConfigSnapshot: (snapshot: unknown) => snapshot || {},
    modelIcon: () => undefined,
    modelOptionLabel: (_config: unknown, value: string) => value,
    hasSystemModelProfile: () => false,
    normalizeModelOptionValue: (value: unknown) => value,
    channelConnectionSignature: () => "",
    defaultBaseUrlForApiFormat: () => "",
    defaultBaseUrlForChannelInterface: () => "",
};
mock.module("@/stores/use-config-store", () => configStoreMock);
mock.module("@/components/canvas/canvas-node-generation", () => ({ buildNodeGenerationContext: (_nodes: any, _edges: any, _id: any, prompt: string) => ({ prompt, referenceImages: [], referenceVideos: [], referenceAudios: [], characterReferences: [], resolvedCharacterVoices: [] }), hydrateNodeGenerationContext: async (context: any) => context }));
mock.module("@/pages/canvas/canvas-assistant-proposal-execution", () => ({ buildConfirmedGenerationConfig: () => ({ model: "fixture", taskWorkflowProvider: "model", size: "1:1" }) }));
mock.module("@/lib/canvas/canvas-generation-submission", () => ({ canReleaseCanvasGenerationSource: () => false, canvasGenerationPromptMetadata: () => ({}), canvasGenerationRequestFingerprint: () => "repeat", runCanvasGenerationSubmissionOnce: async (locks: Map<string, any>, id: string, fn: any) => { if (locks.has(id)) return; const running = fn(() => { if (locks.get(id) === running) locks.delete(id); }); locks.set(id, running); try { return await running; } finally { if (locks.get(id) === running) locks.delete(id); } } }));
mock.module("@/lib/canvas/canvas-project-generation", () => ({ isGenerationCanceled: () => false, getGenerationCount: (value: unknown) => Math.max(1, Number(value) || 1) }));
mock.module("@/lib/model-selection", () => ({
    modelCompatibilityError: () => "",
    modelGroupReferenceLimits: () => undefined,
    modelPromptLengthError: () => "",
    modelRequestOptions: () => ({}),
    portraitGenerationError: () => undefined,
    mergeImageCapabilityConfig: (config: unknown) => config,
    mergedImageCapabilityConfig: (config: unknown) => config,
    resolveCompatibleModel: (_config: unknown, selected: string) => selected,
    resolveModelGenerationDefaults: () => ({}),
    resolveModelVideoBooleanOptions: () => ({}),
    resolveVideoOperation: () => undefined,
    inferVideoOperation: () => undefined,
    defaultImageParamsForModel: () => ({}),
    groupModelsByDisplayName: () => [],
    configuredModelDisplayName: (_config: unknown, value: string) => value,
    compatibleModelInGroup: (_config: unknown, models: string[]) => models[0],
    maxModelInputCapacity: () => 0,
}));
mock.module("@/services/skill-runtime", () => ({ skillRuntime: { prepare: async ({ prompt }: any) => ({ prompt, metadata: {} }) } }));
mock.module("@/lib/canvas/canvas-style-execution", () => ({ resolveCanvasStyleExecution: () => undefined }));
mock.module("@/pages/canvas/canvas-generation-failure", () => ({ canvasGenerationRetryBlocked: () => false, canvasImageGenerationHasPendingResult: () => false, canvasImagePendingResultMessage: () => "", canvasGenerationFailureMetadata: () => ({}) }));
mock.module("@/pages/canvas/canvas-reference-links", () => ({ createReferenceLinkResolver: () => undefined }));
mock.module("@/pages/canvas/canvas-image-generation-executor", () => ({ executeImageGeneration: async (input: any) => { dispatched.push(input); input.nodesRef.current = input.canvasNodes.map((n: any) => n.id === input.nodeId ? { ...n, metadata: { ...n.metadata, storageKey: "new:" + n.id, taskId: "new-task:" + n.id } } : n); } }));
mock.module("@/pages/canvas/canvas-media-generation-executors", () => ({ executeVideoGeneration: async (input: any) => { dispatched.push(input); }, executeAudioGeneration: async () => {} }));
mock.module("@/pages/canvas/canvas-text-generation-executor", () => ({ executeTextGeneration: async () => {} }));

const { useCanvasGenerationExecutor } = await import(process.env.BEEFTV_EXECUTOR_MODULE || "@/pages/canvas/use-canvas-generation-executor");
const node = (id: string) => ({ id, type: "image", title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { status: "success", content: "old:" + id, storageKey: "old:" + id, taskId: "old-task:" + id, prompt: "coffee", lastGenerationRequestFingerprint: "repeat" } });
const frozenNodes = [node("image"), node("text")];
const nodesRef = { current: structuredClone(frozenNodes) };
const connectionsRef = { current: [] as any[] };
const no = () => {};
const generate = useCanvasGenerationExecutor({ projectId: "canvas", addedSkills: [], assets: [], nodesRef, connectionsRef, setNodes: no, setConnections: no, setSelectedNodeIds: no, setSelectedConnectionId: no, setDialogNodeId: no, setRunningNodeId: no, startGenerationRequest: () => new AbortController(), finishGenerationRequest: no, bindGenerationTask: no, applyGenerationTaskResult: async () => {} });
const options = { confirmedInputs: { nodes: frozenNodes, connections: [], config: {} as any, assets: [], skills: [] }, skipBillingConfirmation: true };
const first = generate("image", "image", "coffee", options);
const second = generate("text", "image", "coffee", options);
const deadline = Date.now() + 2000;
while (confirmations.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
assert.equal(confirmations.length, 2, "both targets must reach duplicate confirmation");
confirmations[0]!.onOk();
await first;
connectionsRef.current = [{ id: "new-link", fromNodeId: "image", toNodeId: "text" }];
// A user may wait until the first paid task finishes before confirming the second.
confirmations[1]!.onOk();
await second;
assert.equal(dispatched.length, 2);
assert.equal(dispatched[1].canvasNodes.find((n: any) => n.id === "image").metadata.storageKey, "new:image");
assert.equal(nodesRef.current.find(n => n.id === "image")!.metadata.taskId, "new-task:image");
assert.equal(nodesRef.current.find(n => n.id === "text")!.metadata.taskId, "new-task:text");
assert.equal(dispatched[1].canvasConnections[0].id, "new-link");
assert.equal(dispatched[1].sourceNode.metadata.storageKey, "old:text");
assert.equal(frozenNodes[0]!.metadata.storageKey, "old:image");
console.log("PASS: shared frozen inputs, two concurrent targets, delayed repeat confirmation retain live results and connections");
