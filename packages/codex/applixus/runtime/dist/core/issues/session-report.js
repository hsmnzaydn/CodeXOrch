// Leave space for the autofile footer/fingerprint and repeated-report comment.
export const dailyBodyLimit = 60_000;
const score = (session) => session.toolErrors.count + session.userCorrections.count + session.compactions;
const bytes = (value) => Buffer.byteLength(value);
function excerpt(value, limit) {
    if (bytes(value) <= limit)
        return value;
    let end = limit - 32;
    while (end > 0 && bytes(value.slice(0, end)) > limit - 32)
        end = Math.floor(end * 0.8);
    return value.slice(0, end) + "\n[truncated for body limit]";
}
function tally(values) {
    const counts = new Map();
    for (const [key, count] of values)
        counts.set(key, (counts.get(key) ?? 0) + count);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function diagnosticLines(raw) {
    const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(line => line &&
        !/^(?:Chunk ID:|Wall time:|Process exited with code\b|Exit code:|Original token count:|Output:|Warning: truncated output\b|Total output lines:|handle:|status:|source: screen$|(?:oldest |latest )?cursor:|\[truncated for body limit\])/i.test(line) &&
        !/^[\s{}\[\](),:;"'`=-]+$/.test(line));
    const diagnostics = lines.filter(line => /(?:\b(?:error|failed|failure|cannot|exception|traceback)\b|not found|no such|permission denied|NOT_AUTHENTICATED|^usage:)/i.test(line));
    return diagnostics.length ? diagnostics : lines;
}
export function sessionSignals(sessions) {
    const corrections = tally(sessions.map(s => [s.project, s.userCorrections.count])).filter(([, n]) => n);
    const missing = [];
    for (const project of new Set(sessions.map(s => s.project))) {
        const group = sessions.filter(s => s.project === project);
        const loaded = new Set(group.flatMap(s => s.skillsLoaded.map(name => name.split(":").at(-1))));
        for (const skill of new Set(group.flatMap(s => s.projectSkills)))
            if (!loaded.has(skill.split(":").at(-1)))
                missing.push(`${project}: ${skill}`);
    }
    const errors = tally(sessions.flatMap(s => s.toolErrors.texts.flatMap(raw => diagnosticLines(raw).map(line => [line, 1]))));
    return ["## Signals",
        `Projects with most user corrections: ${corrections.slice(0, 5).map(([p, n]) => `${p} (${n})`).join(", ") || "(none)"}`,
        `Project skills never loaded: ${missing.join(", ") || "(none)"}`,
        `Sessions with >=2 compactions: ${sessions.filter(s => s.compactions >= 2)
            .map(s => `${s.project}/${s.route}@${s.startedAt} (${s.compactions})`).join(", ") || "(none)"}`,
        "Most frequent toolError diagnostic lines:",
        ...errors.slice(0, 5).map(([line, n]) => `${n}: ${line}`)].join("\n");
}
function restTable(sessions) {
    const groups = new Map();
    for (const session of sessions) {
        const key = `${session.project}/${session.route}`.replace(/[|\r\n]/g, " ");
        const totals = groups.get(key) ?? [0, 0, 0, 0, 0];
        totals[0]++;
        totals[1] += session.toolErrors.count;
        totals[2] += session.userCorrections.count;
        totals[3] += session.compactions;
        totals[4] += Number(session.unfinished);
        groups.set(key, totals);
    }
    const rows = [...groups];
    const total = (values) => values.reduce((sum, [, counts]) => sum.map((count, i) => count + counts[i]), [0, 0, 0, 0, 0]);
    return [`## Remaining Sessions (${sessions.length})`, "| Project/route | Sessions | Tool errors | Corrections | Compactions | Unfinished |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        `| Total | ${total(rows).join(" | ")} |`,
        ...rows.slice(0, 20).map(([key, totals]) => `| ${key.slice(0, 100)} | ${totals.join(" | ")} |`),
        ...(rows.length > 20 ? [`| Other projects | ${total(rows.slice(20)).join(" | ")} |`] : [])].join("\n");
}
function boundedRecord(session, budget) {
    const raw = JSON.stringify(session);
    if (bytes(raw) <= budget)
        return raw;
    const clipped = { ...session, bodyTruncated: true,
        user: excerpt(session.user, 100), host: excerpt(session.host, 100),
        project: excerpt(session.project, 200), model: excerpt(session.model, 100),
        route: excerpt(session.route, 100),
        skillsLoaded: session.skillsLoaded.slice(0, 10).map(s => excerpt(s, 100)),
        projectSkills: session.projectSkills.slice(0, 10).map(s => excerpt(s, 100)),
        toolCounts: Object.fromEntries(Object.entries(session.toolCounts).slice(0, 20)
            .map(([name, count]) => [excerpt(name, 100), count])),
        toolErrors: { count: session.toolErrors.count, texts: session.toolErrors.texts.map(s => excerpt(s, 150)) },
        userCorrections: { count: session.userCorrections.count,
            lines: session.userCorrections.lines.map(s => excerpt(s, 100)) } };
    // Pathological names/count maps must not displace the ranked sessions.
    if (bytes(JSON.stringify(clipped)) > budget) {
        clipped.skillsLoaded = [];
        clipped.projectSkills = [];
        clipped.toolCounts = {};
        for (let limit = 100; bytes(JSON.stringify(clipped)) > budget && limit >= 1; limit = Math.floor(limit / 2)) {
            const short = (value) => value.slice(0, limit);
            clipped.user = short(session.user);
            clipped.host = short(session.host);
            clipped.project = short(session.project);
            clipped.model = short(session.model);
            clipped.route = short(session.route);
            clipped.firstUserPrompt = short(session.firstUserPrompt);
            clipped.toolErrors.texts = session.toolErrors.texts.map(short);
            clipped.userCorrections.lines = session.userCorrections.lines.map(short);
        }
    }
    return JSON.stringify(clipped);
}
export function dailySessionBody(outcomes, sessions) {
    const signals = sessionSignals(sessions);
    const records = (values) => "## Session Digests\n" + values.map(s => JSON.stringify(s)).join("\n");
    const full = `${signals}\n\n${outcomes}\n\n${records(sessions)}`;
    if (bytes(full) <= dailyBodyLimit)
        return full;
    const ranked = sessions.slice().sort((a, b) => score(b) - score(a));
    const selected = ranked.slice(0, 20), rest = ranked.slice(20);
    const header = `${excerpt(signals, 5000)}\n\n${excerpt(outcomes, 5000)}\n\n` +
        `${excerpt(restTable(rest), 5000)}\n\n## Session Digests (top ${selected.length} by tool errors + corrections + compactions)\n`;
    const budget = Math.floor((dailyBodyLimit - bytes(header) - 100) / Math.max(1, selected.length));
    return header + selected.map(s => boundedRecord(s, budget)).join("\n");
}
