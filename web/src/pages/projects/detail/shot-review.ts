export function appendShotReworkInstruction(notes: unknown, instruction: string) {
    const current = typeof notes === "string" ? notes : "";
    const base = current.split("【审核返工意见】")[0].trimEnd();
    const next = instruction.trim();
    if (!next) return base;
    return `${base ? `${base}\n\n` : ""}【审核返工意见】\n${next}`;
}
