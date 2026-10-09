import { createHash } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
const credentialName = /(token|secret|password|passwd|credential|api[_-]?key|private[_-]?key|auth|key|cookie|session|dsn)/i;
const secretValue = `(\\\\?"[^"\\\\]*\\\\?"|\\\\?'[^'\\\\]*\\\\?'|[^\\s,;}]+)`;
const tokenStopwords = new Set(["is", "was", "has", "had", "have", "not", "of", "for", "in", "to", "the", "a", "an", "and", "or",
    "on", "at", "by", "with", "from", "as", "it", "be", "are", "will", "can", "cannot", "must", "should", "would", "then",
    "expired", "invalid", "missing", "required", "revoked", "refresh", "refreshed", "mismatch", "undefined", "null", "none",
    "empty", "unset", "provided", "found", "given", "supplied", "exchange", "endpoint", "response", "request", "type",
    "format", "length", "count", "limit", "usage", "budget", "stream", "streaming", "ring", "bucket", "value", "name"]);
function headerPattern(name) {
    return new RegExp(`(\\b${name}\\\\?["']?\\s*[:=]\\s*)(?:\\\\?"[^"\\\\\\r\\n]*\\\\?"|\\\\?'[^'\\\\\\r\\n]*\\\\?'|[^\\r\\n]+)`, "gi");
}
export function stripCredentials(value, env = process.env) {
    let text = value
        .replace(/-----BEGIN [A-Z0-9 -]*PRIVATE\x20KEY-----[\s\S]*?-----END [A-Z0-9 -]*PRIVATE\x20KEY-----/gi, "[stripped private key]")
        .replace(headerPattern("(?:Proxy-)?Authorization"), "$1[stripped]")
        .replace(headerPattern("(?:Set-)?Cookie"), "$1[stripped]")
        .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]+|A[K]IA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{8,}|AI\x7aa[A-Za-z0-9_-]{20,})/g, "[stripped]")
        .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[stripped]")
        .replace(/\b(?:bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "[stripped]")
        .replace(/\b(token)\s+([A-Za-z0-9._~+/-]+=*)/gi, (match, word, value) => /\d/.test(value) || !tokenStopwords.has(value.toLowerCase()) ? `${word} [stripped]` : match)
        .replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#\s@]+@/g, "$1[stripped]@")
        .replace(new RegExp(`(\\\\?["']?\\b[A-Za-z0-9_.-]*(?:password|passwd|token|secret|api[_ -]?key|access[_ -]?key|private[_ -]?key|credential)[A-Za-z0-9_.-]*\\b\\\\?["']?\\s*[:=]\\s*)${secretValue}`, "gi"), "$1[stripped]")
        .replace(new RegExp(`(\\\\?["']?\\b[A-Za-z0-9_.-]*[_-]key\\\\?["']?\\s*[:=]\\s*)${secretValue}`, "gi"), "$1[stripped]");
    for (const [name, secret] of Object.entries(env)) {
        if (secret && secret.length >= 8 && credentialName.test(name))
            text = text.split(secret).join("[stripped]");
    }
    const home = env.HOME ?? env.USERPROFILE;
    if (home && isAbsolute(home) && home.length > 1)
        text = text.split(home).join("~");
    return text;
}
export function redactUserPaths(value) {
    return value
        .replace(/\/(?:Users|home)\/[^/\s"'`)]+/g, "~")
        .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`)]+/gi, "~");
}
function normalizeTitle(title) {
    return title.toLowerCase()
        .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/g, "<uuid>")
        .replace(/\b0x[0-9a-f]+\b/g, "<hex>")
        .replace(/\b[0-9a-f]{8,}\b/g, "<hex>")
        .replace(/\d+/g, "<n>")
        .replace(/\s+/g, " ")
        .trim();
}
const packageRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))).replace(/\\/g, "/").replace(/\/+$/, "");
const framePath = /(^|[\s("'=@])((?:[A-Za-z]:[\\/]|\\{2}|~[\\/]|\/)(?:[^\r\n]*?(?::\d+){1,2}(?=[)\s,]|$)|[^)'"`,;\r\n]*))/g;
const fileUrl = /file:\/\/[^\s()'"`,;]*/gi;
function decodeFileUrl(url) {
    const rest = url.slice("file://".length);
    let decoded = rest;
    try {
        decoded = decodeURIComponent(rest);
    }
    catch {
        decoded = rest.replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    return `/${decoded.replace(/[\r\n\t]+/g, " ").replace(/^\/+/, "")}`;
}
function normalizeFramePath(raw) {
    const path = raw.replace(/(?::\d+){1,2}$/, "").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const folded = path.toLowerCase();
    const root = packageRoot.toLowerCase();
    if (root && folded.startsWith(`${root}/`) && !folded.slice(root.length).includes("/node_modules/"))
        return `<pkg>/${path.slice(root.length + 1)}`;
    const segments = path.split("/");
    const base = segments[segments.length - 1] || "unknown";
    if (segments.includes("node_modules"))
        return `<ext>/${base}`;
    return `<abs>/${base}`;
}
export function stackSignature(stack) {
    return stack.replace(/\r\n?/g, "\n").split("\n")
        .map((line) => line.trim())
        .filter((line) => /^at\s/.test(line) || /@.+:\d+(?::\d+)?\)?$/.test(line))
        .slice(0, 8)
        .map((line) => line
        .replace(fileUrl, decodeFileUrl)
        .replace(/\/([A-Za-z]:[\\/])/g, "$1")
        .replace(/\/~([\\/])/g, "~$1")
        .replace(framePath, (_match, lead, path) => `${lead}${normalizeFramePath(path)}`)
        .replace(/(^|[\s("'=@])(node:[A-Za-z0-9_./-]+)/g, "$1<ext>/$2")
        .replace(/:\d+(?::\d+)?/g, "")
        .replace(/\s+/g, " "))
        .join("\n");
}
export function fingerprint(title, stack) {
    return createHash("sha256").update(`${normalizeTitle(title)}\n${stackSignature(stack)}`).digest("hex");
}
