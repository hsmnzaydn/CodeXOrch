import type { NativeWorkerObservation } from "../core/contracts.js";
type Json = Record<string, any>;
interface OrcaWorkerObservation extends NativeWorkerObservation {
    agentLiveness: "live" | "exited" | "unverifiable";
    livenessSource: string;
}
export interface CommandRunner {
    run(args: string[], timeoutMs?: number, options?: {
        unbound?: boolean;
    }): Promise<Record<string, unknown>>;
}
export declare class OrcaCli implements CommandRunner {
    dispatchCapability(): Promise<void>;
    run(args: string[], timeoutMs?: number, options?: {
        unbound?: boolean;
    }): Promise<Json>;
    currentWorkspace(timeoutMs?: number): Promise<{
        id: string;
        path: string;
        head: string;
    }>;
    observe(dispatchId: string): Promise<OrcaWorkerObservation>;
}
export {};
