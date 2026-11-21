import type { SmartFilmScriptReference } from "@/lib/canvas/smart-film-scripts";
import type { ImageAsset } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";

export function smartFilmScriptReferenceBundle(assets: ImageAsset[], names: Record<string, string>, roles: Record<string, string>) {
    const validRoles = new Set<SmartFilmScriptReference["role"]>(["product", "scene", "character", "prop", "other"]);
    const references = assets.map((asset, index) => ({
        title: names[asset.id] || asset.title,
        role: validRoles.has(roles[asset.id] as SmartFilmScriptReference["role"]) ? (roles[asset.id] as SmartFilmScriptReference["role"]) : "prop",
        imageIndex: index + 1,
    })) satisfies SmartFilmScriptReference[];
    const referenceImages = assets.map((asset, index): ReferenceImage => {
        const title = names[asset.id] || asset.title || `参考图 ${index + 1}`;
        const dataUrl = asset.data.dataUrl || "";
        return {
            id: asset.id,
            name: title,
            type: asset.data.mimeType || "image/png",
            dataUrl: asset.data.storageKey ? "" : dataUrl,
            ...(/^https?:\/\//i.test(dataUrl) ? { url: dataUrl } : {}),
            ...(asset.data.storageKey ? { storageKey: asset.data.storageKey } : {}),
            ...(asset.data.bytes ? { bytes: asset.data.bytes } : {}),
            ...(asset.data.width ? { width: asset.data.width } : {}),
            ...(asset.data.height ? { height: asset.data.height } : {}),
        };
    });
    return { references, referenceImages };
}
