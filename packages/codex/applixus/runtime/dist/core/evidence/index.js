import { isAbsolute, join } from "node:path";
export function receiptDirectory(root) {
    const directory = process.env.APPLIXUS_EVIDENCE_DIR ?? join(root, ".applixus", "evidence");
    if (!isAbsolute(directory))
        throw new Error("Host/runner receipt directory must be absolute");
    return directory;
}
