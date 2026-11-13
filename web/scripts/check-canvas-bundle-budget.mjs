import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const PROJECT_GZIP_BUDGET = 450 * 1024;
const ANTD_GZIP_BUDGET = 450 * 1024;

export function checkCanvasBundleBudget(dist = join(import.meta.dir, "..", "dist")) {
    const manifest = JSON.parse(readFileSync(join(dist, "version.json"), "utf8"));
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const projectFiles = files.filter((file) => /^static\/project-.*\.js$/.test(file));
    const antdFiles = files.filter((file) => /^static\/vendor-antd.*\.js$/.test(file));
    if (projectFiles.length === 0) throw new Error("version.json 中没有 canvas project chunk");
    if (antdFiles.length === 0) throw new Error("version.json 中没有 Ant Design vendor chunk");

    const measure = (file) => {
        const bytes = readFileSync(join(dist, file));
        return { file, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
    };
    const projects = projectFiles.map(measure).sort((a, b) => b.gzip - a.gzip);
    const antd = antdFiles.map(measure).sort((a, b) => b.gzip - a.gzip);
    for (const item of [...projects, ...antd]) {
        console.log(`[bundle] ${item.file} raw=${Math.round(item.raw / 1024)}KB gzip=${Math.round(item.gzip / 1024)}KB`);
    }
    if (projects[0].gzip > PROJECT_GZIP_BUDGET) {
        throw new Error(`canvas project chunk ${Math.round(projects[0].gzip / 1024)}KB gzip 超过 ${PROJECT_GZIP_BUDGET / 1024}KB 预算`);
    }
    if (antd[0].gzip > ANTD_GZIP_BUDGET) {
        throw new Error(`Ant Design chunk ${Math.round(antd[0].gzip / 1024)}KB gzip 超过 ${ANTD_GZIP_BUDGET / 1024}KB 预算`);
    }
    return { projects, antd };
}

if (import.meta.main) {
    checkCanvasBundleBudget();
    console.log("canvas bundle budget ok");
}
