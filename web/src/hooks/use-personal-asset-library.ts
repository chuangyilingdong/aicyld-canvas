import { useQuery } from "@tanstack/react-query";
import { assetLibraryQueryKey } from "@/components/assets/asset-view-session";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { loadWorkspaceAssetLibraryPage } from "@/services/workspace-asset-read";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const EMPTY_ASSETS: Asset[] = [];
const PERSONAL_ASSET_PAGE_SIZE = 100;
const PERSONAL_ASSET_INITIAL_PAGES = 3;
const PERSONAL_ASSET_SEARCH_PAGE_SIZE = 30;

/** Canvas entry points share the personal library's canonical read boundary. */
export function usePersonalAssetLibrary(enabled = true) {
    const hydrated = useAssetStore((state) => state.hydrated);
    const localAssets = useAssetStore((state) => state.assets);
    const query = useQuery({
        queryKey: assetLibraryQueryKey("canvas-personal-library"),
        enabled: hydrated && enabled,
        queryFn: async ({ signal }) => {
            const first = await loadWorkspaceAssetLibraryPage({ page: 1, pageSize: PERSONAL_ASSET_PAGE_SIZE, status: "active", signal });
            const remainingPages = Math.min(PERSONAL_ASSET_INITIAL_PAGES - 1, Math.max(0, Math.ceil(first.canonicalTotal / PERSONAL_ASSET_PAGE_SIZE) - 1));
            const remaining = remainingPages
                ? await Promise.all(Array.from({ length: remainingPages }, (_, index) => loadWorkspaceAssetLibraryPage({ page: index + 2, pageSize: PERSONAL_ASSET_PAGE_SIZE, status: "active", signal })))
                : [];
            const assets = [first, ...remaining].flatMap((result) => result.assets);
            return [...new Map(assets.filter((asset) => asset.status !== "archived" && asset.kind !== "entity").map((asset) => [asset.id, asset])).values()];
        },
        staleTime: 60_000,
        refetchOnMount: false,
        retry: 1,
    });
    return [...new Map([...localAssets.slice(0, PERSONAL_ASSET_PAGE_SIZE * PERSONAL_ASSET_INITIAL_PAGES), ...(query.data ?? EMPTY_ASSETS)].map((asset) => [asset.id, asset])).values()]
        .filter((asset) => asset.status !== "archived" && asset.kind !== "entity");
}

/** Server-backed search keeps older assets reachable without loading the whole library. */
export function usePersonalAssetLibrarySearch(query: string, enabled = true) {
    const debouncedQuery = useDebouncedValue(query.trim(), 220);
    const search = useQuery({
        queryKey: assetLibraryQueryKey("canvas-personal-library-search", debouncedQuery),
        enabled: enabled && Boolean(debouncedQuery),
        queryFn: async ({ signal }) => {
            const result = await loadWorkspaceAssetLibraryPage({ page: 1, pageSize: PERSONAL_ASSET_SEARCH_PAGE_SIZE, status: "active", query: debouncedQuery, signal });
            return result.assets.filter((asset) => asset.status !== "archived" && asset.kind !== "entity");
        },
        staleTime: 30_000,
        retry: 1,
    });
    return search.data ?? EMPTY_ASSETS;
}
