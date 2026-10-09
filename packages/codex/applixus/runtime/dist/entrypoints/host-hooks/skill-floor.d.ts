import type { SkillFloor } from "../../core/context/index.js";
import type { ProjectBinding } from "../../core/contracts.js";
import { selectLocalCapabilities } from "../../core/capabilities/catalog/index.js";
type FloorContext = Parameters<typeof selectLocalCapabilities>[0];
export declare function validFloor(value: unknown, binding: ProjectBinding, current: FloorContext): value is SkillFloor;
export {};
