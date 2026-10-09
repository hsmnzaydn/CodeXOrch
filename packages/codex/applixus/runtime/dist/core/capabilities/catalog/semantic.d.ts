import type { CapabilityDescriptor } from "../../contracts.js";
import type { JevDecisionEnvelope, JevOptions } from "../../../adapters/jev/index.js";
export interface SelectionOptions {
    apiKey?: string;
    timeoutMs?: number;
    fetch?: JevOptions["fetch"];
}
export declare function optionalSelection(input: SelectionOptions & {
    request?: string;
    catalog: {
        revision: string;
    };
}, optional: CapabilityDescriptor[]): Promise<JevDecisionEnvelope | undefined>;
