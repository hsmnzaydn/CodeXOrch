type Event = Record<string, unknown>;
type WriteClass = "product-write" | "allowed" | "unknown";
export declare const leadRedirect: string;
export declare function classifyLeadWrite(event: Event): WriteClass;
export declare function leadWriteDecision(event: Event, isLead?: boolean): {
    deny: boolean;
    note?: string;
};
export declare function leadGuardFailure(error: unknown, worker: boolean): {
    exitCode: number;
    stderr: string;
};
export {};
