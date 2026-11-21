type Entity = { id: string; [key: string]: unknown };
type CanvasLike = Record<string, unknown> & {
    nodes?: Entity[];
    connections?: Array<Entity & { fromNodeId?: string; toNodeId?: string }>;
    chatSessions?: Entity[];
};

export type MockCanvasDocumentPatch = {
    upsertNodes?: Entity[];
    deleteNodeIds?: string[];
    upsertConnections?: Array<Entity & { fromNodeId?: string; toNodeId?: string }>;
    deleteConnectionIds?: string[];
    upsertChatSessions?: Entity[];
    deleteChatSessionIds?: string[];
    fields?: Record<string, unknown>;
};

export function applyMockCanvasDocumentPatch<T extends CanvasLike>(current: T, patch: MockCanvasDocumentPatch): T {
    const document = structuredClone(current) as T;
    const deletedNodes = new Set(patch.deleteNodeIds ?? []);
    const deletedConnections = new Set(patch.deleteConnectionIds ?? []);
    const deletedChats = new Set(patch.deleteChatSessionIds ?? []);
    const nodeUpserts = new Map((patch.upsertNodes ?? []).map((item) => [item.id, item]));
    const connectionUpserts = new Map((patch.upsertConnections ?? []).map((item) => [item.id, item]));
    const chatUpserts = new Map((patch.upsertChatSessions ?? []).map((item) => [item.id, item]));

    const nodes = (document.nodes ?? []).filter((item) => !deletedNodes.has(item.id)).map((item) => nodeUpserts.get(item.id) ?? item);
    for (const item of patch.upsertNodes ?? []) {
        if (!deletedNodes.has(item.id) && !nodes.some((node) => node.id === item.id)) nodes.push(item);
    }
    document.nodes = nodes;

    const connections = (document.connections ?? [])
        .filter((item) => !deletedConnections.has(item.id) && !deletedNodes.has(item.fromNodeId ?? "") && !deletedNodes.has(item.toNodeId ?? ""))
        .map((item) => connectionUpserts.get(item.id) ?? item);
    for (const item of patch.upsertConnections ?? []) {
        if (!connections.some((edge) => edge.id === item.id)) connections.push(item);
    }
    document.connections = connections;

    const chats = (document.chatSessions ?? []).filter((item) => !deletedChats.has(item.id)).map((item) => chatUpserts.get(item.id) ?? item);
    for (const item of patch.upsertChatSessions ?? []) {
        if (!chats.some((chat) => chat.id === item.id)) chats.push(item);
    }
    document.chatSessions = chats;
    Object.assign(document, patch.fields ?? {});
    return document;
}
