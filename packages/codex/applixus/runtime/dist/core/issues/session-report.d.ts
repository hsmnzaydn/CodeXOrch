import type { SessionDigest } from "./session-digest.js";
export declare const dailyBodyLimit = 60000;
export declare function sessionSignals(sessions: SessionDigest[]): string;
export declare function dailySessionBody(outcomes: string, sessions: SessionDigest[]): string;
