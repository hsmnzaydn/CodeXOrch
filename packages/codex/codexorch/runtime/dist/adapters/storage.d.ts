import type { ProjectionStore } from "../core/contracts.js";
export declare class FileProjectionStore implements ProjectionStore {
    private readonly directory;
    constructor(directory: string);
    private openKnowledge;
    readonly knowledge: NonNullable<ProjectionStore["knowledge"]>;
    private path;
    load(key: string): Promise<unknown>;
    scan(prefix: string): Promise<unknown[]>;
    save(key: string, value: unknown): Promise<void>;
}
