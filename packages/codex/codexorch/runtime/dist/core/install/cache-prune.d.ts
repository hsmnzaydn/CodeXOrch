import { spawnSync } from "node:child_process";
export declare function versionBehind(installed: string, advertised: string): boolean;
export declare function claudeCacheVersions(installed: Record<string, unknown>): Map<string, string[]>;
export declare function prunePluginCache(configDir: string, marketplace: "codexorch" | "codexorch", installed: ReadonlyMap<string, readonly string[]>): Promise<string[]>;
export declare function keepPreviousPluginCaches<T>(configDir: string, plugins: readonly string[], advertised: string, update: () => Promise<T>, warn?: (message: string) => void | Promise<void>): Promise<T>;
export declare function pruneInstalledPluginCaches(env?: NodeJS.ProcessEnv, run?: typeof spawnSync): Promise<string[]>;
