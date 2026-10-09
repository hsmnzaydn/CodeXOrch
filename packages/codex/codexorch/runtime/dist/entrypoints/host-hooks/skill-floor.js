import { isAbsolute } from "node:path";
import { selectLocalCapabilities } from "../../core/capabilities/catalog/index.js";
export function validFloor(value, binding, current) {
    const floor = value;
    if (!floor || floor.binding?.repository !== binding.repository ||
        floor.binding?.canonicalRoot !== binding.canonicalRoot ||
        floor.binding?.productVariant !== binding.productVariant || !Array.isArray(floor.skillRefs) ||
        floor.skillRefs.length > 8 || !floor.skillRefs.every(item => item && typeof item.id === "string" && typeof item.entrypoint === "string" && isAbsolute(item.entrypoint)))
        return false;
    const permitted = selectLocalCapabilities({ ...current, binding, optionalIds: [],
        floorIds: floor.skillRefs.map(item => item.id) }).skillRefs;
    return floor.skillRefs.every(item => permitted.some(reference => reference.id === item.id && reference.entrypoint === item.entrypoint));
}
