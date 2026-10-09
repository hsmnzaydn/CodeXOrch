import { DEFAULT_API_KEY } from "./defaults.js";
export const noulQuestion = (instructions) => ({ type: "noul", instructions });
export const choiceQuestion = (instructions, criteria) => ({ type: "choice", instructions, criteria });
export const scoreQuestion = (instructions, criteria) => ({ type: "score", instructions, criteria });
const DEFAULT_MODEL = "openrouter/typesafe/jev-1.13";
const DEFAULT_URL = process.env.CODEXORCH_JEV_BASE_URL ?? "";
// At most 16 questions per request; raise this after provider-size evaluation.
const QUESTION_BUDGET = 16;
// Byte ceilings conservatively bound token limits; replace with provider token accounting when available.
const STATE_QUESTION_BUDGET = 32_000;
const REQUEST_BUDGET = 64_000;
const bytes = (text) => new TextEncoder().encode(text).length;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const probability = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function validateQuestions(questions) {
    return Object.keys(questions).length > 0 && Object.entries(questions).every(([id, value]) => id.length > 0 && isRecord(value) && typeof value.instructions === "string" &&
        value.instructions.trim().length > 0 && (value.type === "noul" ||
        (value.type === "choice" && isRecord(value.criteria) &&
            Object.keys(value.criteria).length >= 2 &&
            Object.entries(value.criteria).every(([key, description]) => key.length > 0 && typeof description === "string" && description.trim().length > 0)) ||
        (value.type === "score" && Array.isArray(value.criteria) && value.criteria.length >= 2 &&
            value.criteria.every((criterion) => typeof criterion === "string" && criterion.trim().length > 0))));
}
function parseResponse(value, questions) {
    if (!isRecord(value) || typeof value.model !== "string" || !value.model ||
        !isRecord(value.answers) || !isRecord(value.usage) ||
        !count(value.usage.input_tokens) || !count(value.usage.output_tokens) ||
        (value.usage.cost !== undefined &&
            (typeof value.usage.cost !== "number" || !Number.isFinite(value.usage.cost) || value.usage.cost < 0))) {
        return null;
    }
    for (const [id, question] of Object.entries(questions)) {
        const answer = value.answers[id];
        if (!isRecord(answer) || answer.type !== question.type)
            return null;
        if (question.type === "noul") {
            if (!probability(answer.noul))
                return null;
        }
        else if (question.type === "choice") {
            const probabilities = answer.probabilities;
            if (typeof answer.choice !== "string" || !(answer.choice in question.criteria) ||
                !isRecord(probabilities) || !probability(answer.confidence) ||
                Object.keys(probabilities).length !== Object.keys(question.criteria).length ||
                !Object.keys(question.criteria).every((key) => probability(probabilities[key])))
                return null;
        }
        else {
            const probabilities = answer.probabilities;
            const legend = answer.legend;
            const keys = question.criteria.map((_, index) => String(index));
            if (typeof answer.score !== "number" || !Number.isFinite(answer.score) ||
                answer.score < 0 || answer.score > question.criteria.length - 1 ||
                !probability(answer.confidence) ||
                !isRecord(probabilities) || !isRecord(legend) ||
                Object.keys(probabilities).length !== keys.length || Object.keys(legend).length !== keys.length ||
                !keys.every((key) => probability(probabilities[key]) && legend[key] === question.criteria[Number(key)]))
                return null;
        }
    }
    return {
        model: value.model,
        answers: value.answers,
        usage: { inputTokens: value.usage.input_tokens, outputTokens: value.usage.output_tokens },
        provider: typeof value.provider === "string" ? value.provider : undefined,
        responseId: typeof value.id === "string" ? value.id : undefined,
        cost: value.usage.cost,
        effectiveEffort: typeof value.effort === "string" && value.effort ? value.effort : "unknown",
    };
}
// One bounded request; callers compose optional selections under local policy.
export class JevDecisionAdapter {
    options;
    constructor(options) {
        this.options = options;
    }
    async decide(state, questions) {
        const started = performance.now();
        const model = this.options.model ?? process.env.CODEXORCH_JEV_MODEL ?? DEFAULT_MODEL;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
        const base = {
            stateRevision: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
            catalogRevision: this.options.catalogRevision, questionVersion: this.options.questionVersion,
            model, requestedModel: model, effectiveEffort: "unknown", answers: {},
            selectedIds: [], alternatives: [], mode: "native-degraded", latencyMs: "unknown", usage: "unknown",
        };
        const degraded = (degradedReason) => ({ ...base, degradedReason, latencyMs: Math.round(performance.now() - started) });
        if (!state.trim() || !validateQuestions(questions) ||
            !this.options.catalogRevision || !this.options.questionVersion)
            return degraded("invalid_request");
        const body = JSON.stringify({ model, state, questions });
        const longest = Math.max(...Object.values(questions).map(question => bytes(JSON.stringify(question))));
        if (bytes(state) + longest > STATE_QUESTION_BUDGET || bytes(body) > REQUEST_BUDGET)
            return degraded("state_budget");
        if (Object.keys(questions).length > QUESTION_BUDGET)
            return degraded("question_budget");
        if (Object.keys(this.options.questionRelations ?? {}).length)
            return degraded("invalid_question_relations");
        if ((this.options.selectionQuestionIds ?? []).some(id => questions[id]?.type !== "choice"))
            return degraded("invalid_selection_question");
        const apiKey = process.env.JEV_API_KEY ?? this.options.apiKey ?? DEFAULT_API_KEY;
        if (!apiKey)
            return degraded("missing_key");
        let url;
        try {
            url = new URL(this.options.baseUrl ?? process.env.CODEXORCH_JEV_BASE_URL ?? DEFAULT_URL);
            if (url.protocol !== "https:" || url.username || url.password)
                return degraded("invalid_base_url");
        }
        catch {
            return degraded("invalid_base_url");
        }
        const timeoutMs = this.options.timeoutMs ?? 10_000;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
            return degraded("invalid_timeout");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException("Selection deadline", "TimeoutError")), timeoutMs);
        const signal = controller.signal;
        try {
            const work = (async () => {
                const response = await (this.options.fetch ?? fetch)(url, {
                    method: "POST", headers: { Authorization: `bearer ${apiKey}`, "Content-Type": "application/json" },
                    body, signal,
                });
                if (!response.ok)
                    return degraded(`http_${response.status}`);
                let value;
                try {
                    value = await response.json();
                }
                catch {
                    return degraded("invalid_json");
                }
                const parsed = parseResponse(value, questions);
                if (!parsed)
                    return degraded("invalid_response");
                const selectedIds = [];
                const alternatives = [];
                for (const id of this.options.selectionQuestionIds ?? []) {
                    const answer = parsed.answers[id];
                    if (!isRecord(answer) || !isRecord(answer.probabilities) || typeof answer.choice !== "string")
                        return degraded("invalid_selection_question");
                    const ranks = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
                    if (ranks[0]?.[0] !== answer.choice || ranks[0]?.[1] === ranks[1]?.[1])
                        return { ...degraded("ambiguous_choice"), usage: parsed.usage };
                    if (answer.choice !== "none")
                        selectedIds.push(answer.choice);
                    alternatives.push(...ranks.map(([key]) => key).filter(key => key !== answer.choice));
                }
                return { ...base, model: parsed.model, effectiveEffort: parsed.effectiveEffort,
                    answers: parsed.answers, usage: parsed.usage, mode: "live", selectedIds, alternatives,
                    latencyMs: Math.round(performance.now() - started),
                    ...(parsed.provider === undefined ? {} : { provider: parsed.provider }),
                    ...(parsed.responseId === undefined ? {} : { responseId: parsed.responseId }),
                    ...(parsed.cost === undefined ? {} : { cost: parsed.cost }) };
            })();
            return await new Promise((resolve, reject) => {
                const onAbort = () => reject(signal.reason);
                if (signal.aborted)
                    return onAbort();
                signal.addEventListener("abort", onAbort, { once: true });
                work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
            });
        }
        catch (error) {
            return degraded(error instanceof Error && /^(TimeoutError|AbortError)$/.test(error.name)
                ? "timeout" : "transport_error");
        }
        finally {
            clearTimeout(timer);
        }
    }
}
