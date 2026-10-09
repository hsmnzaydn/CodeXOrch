import type { ContextPack } from "../core/contracts.js";
interface Server {
    name: string;
    enabled: boolean;
}
export declare function mcpOverrides(servers: readonly Server[], selection: string, capabilityServers?: readonly string[]): string[];
export declare function codexMcpArgs(cwd: string, brief?: string, context?: Pick<ContextPack, "binding" | "selectedCapabilities">): Promise<string[]>;
export {};
