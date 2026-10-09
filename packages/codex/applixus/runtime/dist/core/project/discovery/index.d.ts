import type { ProjectBinding } from "../../contracts.js";
import type { VerificationProfile } from "../../evidence/index.js";
export interface ProjectProfile {
    binding: ProjectBinding;
    revision: string;
    languages: string[];
    packageManagers: string[];
    buildCommands: string[];
    testCommands: string[];
    manifests: string[];
    verificationProfile?: VerificationProfile;
}
export declare function discoverProject(binding: ProjectBinding): Promise<ProjectProfile>;
