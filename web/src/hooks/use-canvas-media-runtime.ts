import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const MEDIA_ROOT_MARGIN = "600px";
const ZOOM_RETRY_MS = 80;

type VisibilityEntry = {
    element: Element;
    onVisible: () => void;
};

const visibilityEntries = new Map<Element, VisibilityEntry>();
const pendingVisibility = new Set<Element>();
let visibilityObserver: IntersectionObserver | null = null;
let zoomRetryTimer: ReturnType<typeof setTimeout> | null = null;

function isCanvasZooming(element: Element) {
    return Boolean(element.closest('[data-canvas-viewport-zooming="true"]'));
}

function flushPendingVisibility() {
    zoomRetryTimer = null;
    for (const element of [...pendingVisibility]) {
        if (!element.isConnected) {
            pendingVisibility.delete(element);
            visibilityEntries.delete(element);
            visibilityObserver?.unobserve(element);
            continue;
        }
        if (isCanvasZooming(element)) continue;
        pendingVisibility.delete(element);
        visibilityObserver?.unobserve(element);
        visibilityEntries.get(element)?.onVisible();
    }
    if (pendingVisibility.size > 0) zoomRetryTimer = setTimeout(flushPendingVisibility, ZOOM_RETRY_MS);
}

function ensureVisibilityObserver() {
    if (visibilityObserver || typeof IntersectionObserver === "undefined") return visibilityObserver;
    visibilityObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting || !visibilityEntries.has(entry.target)) continue;
            if (isCanvasZooming(entry.target)) {
                pendingVisibility.add(entry.target);
                if (!zoomRetryTimer) zoomRetryTimer = setTimeout(flushPendingVisibility, ZOOM_RETRY_MS);
                continue;
            }
            const registered = visibilityEntries.get(entry.target);
            visibilityEntries.delete(entry.target);
            visibilityObserver?.unobserve(entry.target);
            registered?.onVisible();
        }
    }, { rootMargin: MEDIA_ROOT_MARGIN });
    return visibilityObserver;
}

function observeCanvasMedia(element: Element, onVisible: () => void) {
    visibilityEntries.set(element, { element, onVisible });
    const observer = ensureVisibilityObserver();
    if (!observer) {
        visibilityEntries.delete(element);
        onVisible();
        return () => {};
    }
    observer.observe(element);
    return () => {
        visibilityEntries.delete(element);
        pendingVisibility.delete(element);
        observer.unobserve(element);
    };
}

export function useCanvasMediaNearViewport(ref: RefObject<Element | null>) {
    const [nearViewport, setNearViewport] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        return observeCanvasMedia(element, () => setNearViewport(true));
    }, [ref]);
    return nearViewport;
}

const pixelRatioListeners = new Set<() => void>();
let resolutionQuery: MediaQueryList | null = null;

function currentPixelRatio() {
    return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

function notifyPixelRatio() {
    for (const listener of pixelRatioListeners) listener();
    bindResolutionQuery();
}

function bindResolutionQuery() {
    resolutionQuery?.removeEventListener("change", notifyPixelRatio);
    resolutionQuery = typeof window === "undefined" ? null : window.matchMedia(`(resolution: ${currentPixelRatio()}dppx)`);
    resolutionQuery?.addEventListener("change", notifyPixelRatio);
}

function subscribePixelRatio(listener: () => void) {
    if (pixelRatioListeners.size === 0) {
        window.addEventListener("resize", notifyPixelRatio);
        bindResolutionQuery();
    }
    pixelRatioListeners.add(listener);
    return () => {
        pixelRatioListeners.delete(listener);
        if (pixelRatioListeners.size === 0) {
            window.removeEventListener("resize", notifyPixelRatio);
            resolutionQuery?.removeEventListener("change", notifyPixelRatio);
            resolutionQuery = null;
        }
    };
}

export function useCanvasPixelRatio() {
    return useSyncExternalStore(subscribePixelRatio, currentPixelRatio, () => 1);
}
