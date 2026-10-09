export declare function selectedContext(root: string, head: string, request: string): Promise<{
    binding: import("../../core/contracts.js").ProjectBinding;
    skillRefs: {
        id: string;
        entrypoint: string;
    }[];
    selectedCapabilities: {
        id: string;
        version: string;
    }[];
} | undefined>;
