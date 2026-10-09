type Event = Record<string, unknown>;
type State = {
    lead: boolean;
    worker: boolean;
};
export declare function leadSessionState(event: Event, host: string, env?: NodeJS.ProcessEnv): State;
export declare function nativeSubagent(event: Event): boolean;
export {};
