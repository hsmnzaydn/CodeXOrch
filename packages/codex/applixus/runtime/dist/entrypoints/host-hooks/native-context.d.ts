import { type Alias } from "../../core/routes/index.js";
export declare function projectPath(cwd: string): Promise<{
    path: string;
    head: string;
}>;
export declare function matchesInstalledProject(event: Record<string, unknown>, host: string, root: string): Promise<boolean>;
export declare function assignedRoute(host: "claude" | "codex", payload: Record<string, unknown>): Alias | undefined;
