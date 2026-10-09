import { leadSessionState } from "./lead-identity.js";
import { leadRedirect } from "./lead-write.js";
export function leadAgentDecision(event, host, isLead) {
    if (event.tool_name !== "Agent" || !(isLead ?? leadSessionState(event, host).lead))
        return {};
    return { issue: leadRedirect };
}
