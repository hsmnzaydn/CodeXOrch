export declare function receiptDirectory(root: string): string;
export interface VerificationProfile {
    version: 1;
    checks: {
        id: string;
        type: "test" | "build" | "lint" | "check";
        runner?: "node" | "pytest" | "junit-xml";
        command?: string;
        args?: string[];
    }[];
    independentReview: boolean;
    visualReview?: boolean;
}
