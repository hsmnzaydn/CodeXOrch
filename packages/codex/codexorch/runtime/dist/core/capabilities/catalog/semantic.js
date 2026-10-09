import { JevDecisionAdapter, choiceQuestion } from "../../../adapters/jev/index.js";
import { stripCredentials } from "../../issues/sanitize.js";
export async function optionalSelection(input, optional) {
    if (!input.request?.trim() || !optional.length)
        return undefined;
    const questions = Object.fromEntries(optional.map(item => [item.id, choiceQuestion(`Is this optional expertise directly useful for the actual task? Select none when unrelated.`, { [item.id]: item.description, none: "Not useful for this task" })]));
    const adapter = new JevDecisionAdapter({
        catalogRevision: input.catalog.revision, questionVersion: "optional-skills-v1",
        selectionQuestionIds: optional.map(item => item.id),
        timeoutMs: Math.min(2000, Math.max(1, input.timeoutMs ?? 2000)),
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
    });
    try {
        const result = await adapter.decide(JSON.stringify({
            request: stripCredentials(input.request),
            optionalSkills: optional.map(({ id, description }) => ({ id, description })),
            instructions: "Rank task-relevant optional expertise only. Local code owns rules, binding, dependencies and authority.",
        }), questions);
        const confidence = (id) => {
            const answer = result.answers[id];
            return answer?.probabilities?.[id] ?? 0;
        };
        result.selectedIds.sort((a, b) => confidence(b) - confidence(a) || a.localeCompare(b));
        return result;
    }
    catch {
        return undefined;
    }
}
