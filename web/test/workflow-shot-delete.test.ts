import { expect, spyOn, test } from "bun:test";

import { http } from "@/services/api/request";
import { deleteProjectShot } from "@/services/api/projects";

test("镜头删除 API 使用项目和镜头双重路径作用域", async () => {
    const deleteRequest = spyOn(http, "delete").mockResolvedValue({ deleted: true });
    await deleteProjectShot("project/a", "shot b");
    expect(deleteRequest).toHaveBeenCalledWith("/projects/project%2Fa/shots/shot%20b");
    deleteRequest.mockRestore();
});
