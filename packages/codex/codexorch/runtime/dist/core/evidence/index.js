import { isAbsolute, join } from "node:path";
export function receiptDirectory(root) {
    const directory = process.env.CODEXORCH_EVIDENCE_DIR ?? join(root, ".codexorch", "evidence");
    if (!isAbsolute(directory))
        throw new Error("Host/runner receipt directory must be absolute");
    return directory;
}
