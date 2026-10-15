import { useSyncExternalStore } from "react";

import { getActiveUserScopeEpoch, subscribeUserScope } from "@/lib/user-scope";
import {
    assertUserScope,
    isUserScopeAbandonedError,
    userScopeMatches,
    type CapturedUserScope,
} from "@/lib/user-scope-guard";

export const ASSET_LIBRARY_QUERY_ROOT = "asset-library";
export const ASSET_FOLDER_QUERY_ROOT = "asset-folders";
export const ASSET_PICKER_QUERY_ROOT = "asset-picker";

export type AssetViewQueryCache = {
    removeQueries: (filters: { queryKey: readonly unknown[] }) => void;
};

export function dropStaleAssetViewQueries(queryClient: AssetViewQueryCache) {
    queryClient.removeQueries({ queryKey: [ASSET_LIBRARY_QUERY_ROOT] });
    queryClient.removeQueries({ queryKey: [ASSET_FOLDER_QUERY_ROOT] });
    queryClient.removeQueries({ queryKey: [ASSET_PICKER_QUERY_ROOT] });
}

export function subscribeAssetViewScope(queryClient: AssetViewQueryCache, onStoreChange: () => void) {
    return subscribeUserScope(() => {
        dropStaleAssetViewQueries(queryClient);
        onStoreChange();
    });
}

export function useAssetViewGeneration(queryClient: AssetViewQueryCache) {
    return useSyncExternalStore(
        (onStoreChange) => subscribeAssetViewScope(queryClient, onStoreChange),
        getActiveUserScopeEpoch,
        getActiveUserScopeEpoch,
    );
}

export function assetViewQueryKey(root: string, entry: CapturedUserScope, ...parts: unknown[]) {
    return [root, entry.userScope, entry.epoch, ...parts] as const;
}

export function assetLibraryQueryKey(entry: CapturedUserScope, ...parts: unknown[]) {
    return assetViewQueryKey(ASSET_LIBRARY_QUERY_ROOT, entry, ...parts);
}

export function assetFolderQueryKey(entry: CapturedUserScope, ...parts: unknown[]) {
    return assetViewQueryKey(ASSET_FOLDER_QUERY_ROOT, entry, ...parts);
}

export function assetPickerQueryKey(entry: CapturedUserScope, ...parts: unknown[]) {
    return assetViewQueryKey(ASSET_PICKER_QUERY_ROOT, entry, ...parts);
}

export function capturedScopeFromAssetQueryKey(queryKey: readonly unknown[]): CapturedUserScope | undefined {
    const userScope = queryKey[1];
    const epoch = queryKey[2];
    if (typeof userScope !== "string" || typeof epoch !== "number") return undefined;
    return { userScope, epoch };
}

export function expectedScopeFromQueryKey(queryKey: readonly unknown[]): CapturedUserScope {
    const captured = capturedScopeFromAssetQueryKey(queryKey);
    if (!captured) throw new Error("素材查询缺少账号世代");
    return captured;
}

export function sameAssetViewEpoch(queryKey: readonly unknown[] | undefined, entry: CapturedUserScope) {
    const previous = queryKey ? capturedScopeFromAssetQueryKey(queryKey) : undefined;
    return Boolean(previous && previous.userScope === entry.userScope && previous.epoch === entry.epoch);
}

export function keepAssetViewPlaceholder<T>(
    previousData: T | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined,
    entry: CapturedUserScope,
): T | undefined {
    if (!sameAssetViewEpoch(previousQuery?.queryKey, entry)) return undefined;
    return previousData;
}

export function mergeHistoryLibraryAssets<T extends { id: string; status?: string }>(current: T[], next: T[], page: number): T[] {
    const pageItems = next.filter((asset) => asset.status !== "archived");
    const merged = page <= 1 ? pageItems : [...current, ...pageItems.filter((asset) => !current.some((item) => item.id === asset.id))];
    return merged.filter((asset) => asset.status !== "archived");
}

export function shouldSuppressAssetViewError(error: unknown, expected: CapturedUserScope) {
    // 只有「账号切换导致本次操作自我中止」才允许静默——此时视图已过期，弹错会误导用户。
    if (isUserScopeAbandonedError(error)) return true;
    // 真实接口错误一律透出。以前这里还带一个「作用域不匹配就静默」的条件，
    // 结果一旦身份时钟被无关地推进，像「已存在同名素材分类」这种真实错误也会被吞掉，
    // 用户看到的就是「点了保存什么反应都没有」。过期视图上仍然留一条控制台痕迹便于排查。
    if (!userScopeMatches(expected)) {
        console.warn("[assets] 过期视图上的操作失败，仍透出真实错误", error);
    }
    return false;
}

export async function runAssetViewAction<T>(
    expected: CapturedUserScope,
    action: (expected: CapturedUserScope) => Promise<T>,
): Promise<T | undefined> {
    try {
        assertUserScope(expected);
        const value = await action(expected);
        assertUserScope(expected);
        return value;
    } catch (error) {
        if (shouldSuppressAssetViewError(error, expected)) return undefined;
        throw error;
    }
}

