type Json = Record<string, any>;
export interface SessionDigest {
    user: string;
    host: string;
    project: string;
    startedAt: string;
    durationMin: number;
    model: string;
    route: string;
    skillsLoaded: string[];
    projectSkills: string[];
    toolCounts: Record<string, number>;
    toolErrors: {
        count: number;
        texts: string[];
    };
    retriesOfSameCommand: number;
    userCorrections: {
        count: number;
        lines: string[];
    };
    compactions: number;
    tokensIn: number;
    tokensOut: number;
    unfinished: boolean;
    firstUserPrompt: string;
}
export declare function digestSession(rows: Json[], route: string, user: string, now?: number): SessionDigest | undefined;
export declare function collectSessionDigests(env?: NodeJS.ProcessEnv, now?: number, user?: string): Promise<SessionDigest[]>;
export {};
