type Send = (method: string, params: unknown) => Promise<unknown>;
export declare const codexorchHookPrefix = "codexorch@codexorch:codex-hooks/hooks.json:";
export type DiscoveredHook = {
    key: string;
    currentHash: string;
    command?: string;
    eventName?: string;
    enabled?: boolean;
};
export declare function reconcileCodexHookDeclarations(send: Send, home: string, owned: Record<string, string[]>, pluginHooks?: DiscoveredHook[]): Promise<void>;
export {};
