import { HostState } from "./state.js";
export declare function configureCodex(homePath: string, target: string, route: {
    route: string;
    effort?: string;
}, previous?: HostState[], smoke?: boolean): Promise<HostState[]>;
export declare function restoreCodex(host: HostState, home: string, target: string, skipped: string[], shared: boolean): Promise<void>;
