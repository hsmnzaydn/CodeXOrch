interface ClaudeLaunch {
    model?: string;
    effort?: string;
}
export declare function claudeLaunchOptions(command: string): ClaudeLaunch & {
    settings?: string;
};
export declare function claudeSettingsRoute(file: string): ClaudeLaunch;
export declare function claudeEnvRoute(env: NodeJS.ProcessEnv): ClaudeLaunch;
export declare function resolveClaudeRoute(launch: ClaudeLaunch & {
    settings?: string;
}, env: NodeJS.ProcessEnv, project: string): ClaudeLaunch;
export declare function claudeLaunchContext(parent?: number, env?: NodeJS.ProcessEnv, project?: string): Promise<ClaudeLaunch>;
export {};
