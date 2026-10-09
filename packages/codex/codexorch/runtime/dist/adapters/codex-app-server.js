import { spawn } from "node:child_process";
export async function codexRequest(home, cwd, requests, binary = "codex", env = process.env, args = []) {
    const argv = [...args, "app-server", "--stdio"];
    const command = [binary, ...argv].join(" ");
    const child = spawn(binary, argv, { cwd, env: { ...env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let timedOut = false;
    let nextId = 0;
    const pending = new Map();
    const send = (method, params) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
    const rejectAll = (detail, code) => {
        for (const request of pending.values())
            request.reject(Object.assign(new Error(`${command}: ${detail}`), { code }));
        pending.clear();
    };
    child.stderr.on("data", (chunk) => {
        if (!stderr.includes("\n") && stderr.length < 4096)
            stderr += chunk.toString().slice(0, 4096 - stderr.length);
    });
    child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        for (let index; (index = buffer.indexOf("\n")) !== -1;) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            let message;
            try {
                message = JSON.parse(line);
            }
            catch {
                rejectAll("invalid JSON");
                child.kill();
                return;
            }
            if (!message || typeof message !== "object") {
                rejectAll("invalid JSON response shape");
                child.kill();
                return;
            }
            if (message.id === undefined)
                continue;
            const request = pending.get(message.id);
            pending.delete(message.id);
            if (message.error)
                request?.reject(new Error(`${command}: ${message.error.message ?? "Codex request failed"}`));
            else
                request?.resolve(message.result);
        }
    });
    child.on("error", (error) => rejectAll(error.code ?? error.message, error.code));
    child.stdin.on("error", (error) => rejectAll(error.code ?? error.message, error.code));
    child.on("close", (code, signal) => rejectAll(`${timedOut ? "timeout after 15000 ms" : signal ? `signal ${signal}` : `exit ${code}`}; ` +
        (stderr.split(/\r?\n/, 1)[0] || "empty stdout")));
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 15_000);
    try {
        await send("initialize", { clientInfo: { name: "codexorch-installer", version: "1" } });
        child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
        await requests(send);
    }
    finally {
        clearTimeout(timer);
        child.kill();
    }
}
