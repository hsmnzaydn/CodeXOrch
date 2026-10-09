function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid MCP response");
    return value;
}
// Only explicitly scoped knowledge backends use this client; native hosts own registered tools.
export function connectHttp(url, headers = {}) {
    const endpoint = new URL(url);
    if (endpoint.username || endpoint.password ||
        (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" &&
            ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname))))
        throw new Error("MCP endpoint must use HTTPS");
    let session;
    let protocolVersion;
    let nextId = 0;
    let ready;
    const reset = () => { ready = undefined; session = undefined; protocolVersion = undefined; };
    const send = async (method, params, signal, notification = false) => {
        const id = ++nextId;
        const response = await fetch(endpoint, {
            method: "POST", signal,
            headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream",
                ...(session ? { "mcp-session-id": session } : {}),
                ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}) },
            body: JSON.stringify({ jsonrpc: "2.0", ...(!notification ? { id } : {}), method, params }),
        });
        if (response.status === 404 && session)
            reset();
        if (!response.ok)
            throw new Error(`MCP HTTP ${response.status}`);
        const assigned = response.headers.get("mcp-session-id");
        if (assigned)
            session = assigned;
        if (notification)
            return undefined;
        let payload;
        const type = response.headers.get("content-type")?.split(";")[0]?.trim();
        if (type === "application/json")
            payload = await response.json();
        else if (type === "text/event-stream") {
            const reader = response.body?.getReader();
            if (!reader)
                throw new Error("Empty MCP SSE response");
            const decoder = new TextDecoder();
            let buffer = "";
            try {
                while (payload === undefined) {
                    const chunk = await reader.read();
                    if (chunk.done)
                        throw new Error("MCP SSE response ended");
                    buffer += decoder.decode(chunk.value, { stream: true });
                    if (buffer.length > 2 * 1024 * 1024)
                        throw new Error("MCP SSE response too large");
                    for (let end; (end = buffer.search(/\r?\n\r?\n/)) >= 0;) {
                        const event = buffer.slice(0, end);
                        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
                        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
                            .map((line) => line.slice(5).trimStart()).join("\n");
                        if (data) {
                            let item;
                            try {
                                item = JSON.parse(data);
                            }
                            catch {
                                throw new Error("Invalid MCP SSE response");
                            }
                            if (record(item).id === id)
                                payload = item;
                        }
                    }
                }
            }
            finally {
                await reader.cancel();
            }
        }
        else
            throw new Error("Unsupported MCP response type");
        const result = record(payload);
        if (result.id !== id || result.error || !Object.hasOwn(result, "result"))
            throw new Error("MCP request failed");
        return result.result;
    };
    const initialize = () => ready ??= (async () => {
        const result = record(await send("initialize", { protocolVersion: "2025-06-18", capabilities: {},
            clientInfo: { name: "codexorch-knowledge", version: "1" } }, AbortSignal.timeout(10_000)));
        if (typeof result.protocolVersion !== "string")
            throw new Error("Invalid MCP initialize response");
        protocolVersion = result.protocolVersion;
        await send("notifications/initialized", {}, AbortSignal.timeout(10_000), true);
    })().catch((error) => { reset(); throw error; });
    return {
        async listTools() {
            await initialize();
            let response;
            try {
                response = record(await send("tools/list", {}, AbortSignal.timeout(30_000)));
            }
            catch (error) {
                if (!(error instanceof Error) || error.message !== "MCP HTTP 404" || ready)
                    throw error;
                await initialize();
                response = record(await send("tools/list", {}, AbortSignal.timeout(30_000)));
            }
            if (!Array.isArray(response.tools))
                throw new Error("Invalid MCP tool list");
            return response.tools;
        },
        async callTool(name, args, signal) {
            await initialize();
            const result = record(await send("tools/call", { name, arguments: args }, signal));
            if (result.isError)
                throw new Error("MCP tool returned error");
            return result;
        },
    };
}
