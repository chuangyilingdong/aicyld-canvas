type ProjectLibrarySort = "updated" | "name" | "nodes";

type StudioEntry<T> = {
    kind: "studio";
    updatedAt: string;
    name: string;
    item: T;
};

type CanvasEntry<T> = {
    kind: "canvas";
    updatedAt: string;
    name: string;
    nodeCount: number;
    project: T;
};

export type CanvasProjectLibraryEntry<TStudio, TCanvas> = StudioEntry<TStudio> | CanvasEntry<TCanvas>;

/**
 * The library has one visible timeline. Business projects and standalone
 * canvases are different data sources, but users should not have to scan two
 * separate groups to find the thing they last edited.
 */
export function mergeCanvasProjectLibraryEntries<TStudio, TCanvas>(
    studioProjects: Array<{ project: { name: string; updatedAt: string } } & TStudio>,
    canvasProjects: Array<{ title: string; updatedAt: string; nodeCount: number } & TCanvas>,
    sort: ProjectLibrarySort,
): Array<CanvasProjectLibraryEntry<TStudio, TCanvas>> {
    const entries: Array<CanvasProjectLibraryEntry<TStudio, TCanvas>> = [
        ...studioProjects.map((item) => ({
            kind: "studio" as const,
            updatedAt: item.project.updatedAt,
            name: item.project.name,
            item,
        })),
        ...canvasProjects.map((project) => ({
            kind: "canvas" as const,
            updatedAt: project.updatedAt,
            name: project.title,
            nodeCount: project.nodeCount,
            project,
        })),
    ];
    return entries.sort((left, right) => {
        if (sort === "name") return left.name.localeCompare(right.name, "zh-CN");
        if (sort === "nodes") {
            const leftNodes = left.kind === "canvas" ? left.nodeCount : 0;
            const rightNodes = right.kind === "canvas" ? right.nodeCount : 0;
            if (leftNodes !== rightNodes) return rightNodes - leftNodes;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
}
