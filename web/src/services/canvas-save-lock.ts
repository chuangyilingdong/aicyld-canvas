const DEFAULT_LOCK_WAIT_MS = 30_000;
const DEFAULT_LEASE_MS = 60_000;
const LEASE_RETRY_MS = 100;

const tabId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class CanvasSaveLockTimeoutError extends Error {
    constructor() {
        super("画布保存锁等待超时，请稍后重试");
        this.name = "CanvasSaveLockTimeoutError";
    }
}

type LockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type CanvasSaveLockOptions = {
    waitMs?: number;
    leaseMs?: number;
    ownerId?: string;
    storage?: LockStorage;
    useWebLocks?: boolean;
};

type BrowserLocks = {
    request<T>(name: string, options: { mode: "exclusive"; signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>;
};

function lockStorage(options: CanvasSaveLockOptions): LockStorage | undefined {
    if (options.storage) return options.storage;
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

function browserLocks(): BrowserLocks | undefined {
    if (typeof navigator === "undefined") return undefined;
    return (navigator as Navigator & { locks?: BrowserLocks }).locks;
}

export function canvasSaveLockKey(scope: string, canvasId: string) {
    return `infinite-canvas:canvas-save-lock:${scope}:${canvasId}`;
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type LeaseRecord = { ownerId: string; expiresAt: number };

function readLease(storage: LockStorage, key: string): LeaseRecord | undefined {
    try {
        const raw = storage.getItem(key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as Partial<LeaseRecord>;
        if (typeof parsed.ownerId !== "string" || typeof parsed.expiresAt !== "number") return undefined;
        return { ownerId: parsed.ownerId, expiresAt: parsed.expiresAt };
    } catch {
        return undefined;
    }
}

function writeLease(storage: LockStorage, key: string, ownerId: string, leaseMs: number) {
    storage.setItem(key, JSON.stringify({ ownerId, expiresAt: Date.now() + leaseMs } satisfies LeaseRecord));
}

async function withLocalStorageLease<T>(scope: string, canvasId: string, operation: () => Promise<T>, options: CanvasSaveLockOptions) {
    const storage = lockStorage(options);
    if (!storage) return operation();

    const key = canvasSaveLockKey(scope, canvasId);
    const ownerId = options.ownerId || tabId;
    const waitMs = Math.max(250, options.waitMs ?? DEFAULT_LOCK_WAIT_MS);
    const leaseMs = Math.max(1_000, options.leaseMs ?? DEFAULT_LEASE_MS);
    const deadline = Date.now() + waitMs;

    for (;;) {
        const current = readLease(storage, key);
        if (!current || current.expiresAt <= Date.now() || current.ownerId === ownerId) {
            writeLease(storage, key, ownerId, leaseMs);
            const confirmed = readLease(storage, key);
            if (confirmed?.ownerId === ownerId) break;
        }
        if (Date.now() >= deadline) throw new CanvasSaveLockTimeoutError();
        await sleep(LEASE_RETRY_MS);
    }

    const heartbeat = setInterval(
        () => {
            const current = readLease(storage, key);
            if (current?.ownerId !== ownerId) return;
            writeLease(storage, key, ownerId, leaseMs);
        },
        Math.max(1_000, Math.floor(leaseMs / 3)),
    );

    try {
        return await operation();
    } finally {
        clearInterval(heartbeat);
        const current = readLease(storage, key);
        if (current?.ownerId === ownerId) storage.removeItem(key);
    }
}

/**
 * Serialize one canvas save across browser tabs. Web Locks is the primary
 * implementation; localStorage lease is the fallback for browsers without it.
 */
export function withCanvasSaveLock<T>(scope: string, canvasId: string, operation: () => Promise<T>, options: CanvasSaveLockOptions = {}): Promise<T> {
    const locks = options.useWebLocks === false ? undefined : browserLocks();
    if (!locks) return withLocalStorageLease(scope, canvasId, operation, options);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.waitMs ?? DEFAULT_LOCK_WAIT_MS);
    return locks
        .request(`infinite-canvas:canvas-save:${scope}:${canvasId}`, { mode: "exclusive", signal: controller.signal }, operation)
        .catch((error) => {
            if (controller.signal.aborted) throw new CanvasSaveLockTimeoutError();
            throw error;
        })
        .finally(() => clearTimeout(timer));
}
