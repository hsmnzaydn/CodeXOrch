const allowed = {
    issue: ["list", "comment", "create"],
    label: ["list", "create"],
};
export class AutomationAuthorityError extends Error {
    constructor(message) {
        super(`automation authority: ${message}`);
        this.name = "AutomationAuthorityError";
    }
}
export function assertAutofileGh(args) {
    const group = args[0] ?? "";
    const verb = args[1] ?? "";
    if (!(allowed[group] ?? []).includes(verb)) {
        throw new AutomationAuthorityError(`gh ${group} ${verb} is not permitted for bug-draft autofile`.trimEnd());
    }
}
