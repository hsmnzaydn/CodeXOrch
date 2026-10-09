import type { ProjectBinding } from "../../contracts.js";
export interface WorkspaceIdentity {
    id: string;
    path: string;
    head: string;
}
export interface PackIdentity {
    id: string;
    projectPack: boolean;
    repositoryIds: string[];
    folders: string[];
    projectMarker?: string;
}
export declare function bindProject(workspace: WorkspaceIdentity, packs?: PackIdentity[]): Promise<ProjectBinding>;
