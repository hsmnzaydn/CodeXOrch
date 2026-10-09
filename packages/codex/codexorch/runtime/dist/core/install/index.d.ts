export declare function projectInstall(action: "install" | "upgrade" | "uninstall" | "purge", packageRoot: string, targetPath: string, checkpoint?: (point: "after-swap" | "host-settings-write") => void, mode?: "project" | "smoke", explicitActor?: string): Promise<{
    action: "purge";
    version: string;
    plugins: never[];
    skipped?: never;
    marketplace?: never;
} | {
    action: "uninstall";
    version: string;
    plugins: string[];
    skipped: string[];
    marketplace: string;
} | {
    action: "install" | "upgrade";
    version: string;
    plugins: string[];
    skipped?: never;
    marketplace?: never;
}>;
