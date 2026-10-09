# Durable decision

Use only when explicitly asked to persist a reusable decision or preference. Resolve exact project/tenant or explicit global scope first. Search that scope for an equivalent record, preserve source and revision/supersession, and keep credentials and customer data out. Unknown or conflicting scope means no write. Verify the backend's actual saved identity; a submitted request or local draft is not proof of persistence.

Provenance: `pre-release-2.108.13:commands/remember.md` and `references/remember.md` (MIT). Backend-specific scope resolution is deferred to the knowledge adapter; legacy scripts are not invoked.
