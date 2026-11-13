import { useEffect } from "react";
import { create } from "zustand";

type SafetyBlocker = {
    reason: string;
    updatedAt: number;
};

type AppUpdateSafetyStore = {
    blockers: Record<string, SafetyBlocker>;
    setBlocker: (key: string, blocked: boolean, reason: string) => void;
    clearBlocker: (key: string) => void;
};

export const useAppUpdateSafetyStore = create<AppUpdateSafetyStore>((set) => ({
    blockers: {},
    setBlocker: (key, blocked, reason) => set((state) => {
        const current = state.blockers[key];
        if (!blocked) {
            if (!current) return state;
            const blockers = { ...state.blockers };
            delete blockers[key];
            return { blockers };
        }
        if (current?.reason === reason) return state;
        return { blockers: { ...state.blockers, [key]: { reason, updatedAt: Date.now() } } };
    }),
    clearBlocker: (key) => set((state) => {
        if (!state.blockers[key]) return state;
        const blockers = { ...state.blockers };
        delete blockers[key];
        return { blockers };
    }),
}));

/** Register page-local work that must finish before an automatic app update reload. */
export function useAppUpdateSafetyBlocker(key: string, blocked: boolean, reason: string) {
    useEffect(() => {
        const store = useAppUpdateSafetyStore.getState();
        store.setBlocker(key, blocked, reason);
        return () => store.clearBlocker(key);
    }, [blocked, key, reason]);
}
