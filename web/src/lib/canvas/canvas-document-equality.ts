/** Compare document fields without serializing unchanged entity objects. */
export function sameCanvasDocumentValue(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) return false;
        for (let index = 0; index < left.length; index++) {
            if (left[index] === right[index]) continue;
            // The wrapper preserves JSON array rules for holes/undefined/null.
            if (JSON.stringify([left[index]]) !== JSON.stringify([right[index]])) return false;
        }
        return true;
    }
    return JSON.stringify(left) === JSON.stringify(right);
}

const AUTOSAVE_VOLATILE_NODE_KEYS = new Set(["createdAt", "updatedAt"]);

/**
 * Runtime task fields are projected by the backend while a generation task is
 * progressing. Saving the whole canvas document after each poll creates a CAS
 * write storm and makes task completion race ordinary autosave.
 */
const AUTOSAVE_VOLATILE_METADATA_KEYS = new Set([
    "taskStatus",
    "taskProgress",
    "taskStage",
    "taskUpdatedAt",
    "taskStartedAt",
    "taskCompletedAt",
    "taskDurationMs",
    "taskProviderRequestId",
    "taskOfficialStatus",
    "taskReceiptRecorded",
    "generationSubmissionState",
]);

function normalizeAutosaveFields(value: object): Record<string, unknown> {
    const document = value as Record<string, unknown>;
    if (!Array.isArray(document.nodes)) return document;
    return {
        ...document,
        nodes: document.nodes.map((node) => {
            if (!node || typeof node !== "object") return node;
            const item = node as Record<string, unknown>;
            const normalizedNode = { ...item };
            for (const key of AUTOSAVE_VOLATILE_NODE_KEYS) delete normalizedNode[key];
            if (item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)) {
                const metadata = { ...(item.metadata as Record<string, unknown>) };
                for (const key of AUTOSAVE_VOLATILE_METADATA_KEYS) delete metadata[key];
                normalizedNode.metadata = metadata;
            }
            return normalizedNode;
        }),
    };
}

/**
 * Editor autosave comparison. User-visible graph/media fields still count as
 * edits, but backend-owned task telemetry does not trigger a full commit.
 */
export function sameCanvasAutosaveFields(document: object, fields: object): boolean {
    const current = normalizeAutosaveFields(document);
    const next = normalizeAutosaveFields(fields);
    return Object.entries(next).every(([key, value]) => sameCanvasDocumentValue(current[key], value));
}

/** A project may contain other fields; only compare the proposed editor patch. */
export function canvasDocumentMatchesFields(document: object, fields: object): boolean {
    const current = document as Record<string, unknown>;
    return Object.entries(fields).every(([key, value]) => sameCanvasDocumentValue(current[key], value));
}
