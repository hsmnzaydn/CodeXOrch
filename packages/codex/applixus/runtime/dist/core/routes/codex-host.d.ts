export declare function codexLaunchOptions(command: string): {
    model?: string;
    effort?: string;
};
export declare function codexLaunchContext(parent?: number): Promise<{
    model?: string;
    effort?: string;
}>;
