interface LiveTool {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}
interface HostMcpClient {
    listTools(): Promise<readonly LiveTool[]>;
    callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
export declare function connectHttp(url: string, headers?: Record<string, string>): HostMcpClient;
export {};
