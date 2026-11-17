# Condition-scoped refund assurance

BehavProof 0.2.0 source example. See [Japanese adoption guide](../../docs/assurance.ja.md).

From the product checkout, build and run `node scripts/assurance-flow.mjs`. It creates an isolated consumer and a separately pinned local host, runs real Vitest plus explicit assurance observations, collects reports, verifies the gate and generated documents, and tests missing/stale/duplicated/weakened evidence. It does not publish packages, approve a real PR or change GitHub protection.

The contract covers preconditions/authorization, denied-operation state/effects, seeded properties, bounded duplicate-refund sequences, static UI import boundaries and a real HTTP/auth/file-store journey. Six fault variants must produce the corresponding same-input comparison violations. The basic legacy profile is used to isolate these opted-in mandatory assurance conditions; production critical adoption still requires all existing critical coverage, mutation, approval and external-protection obligations.

The store and server are temporary fixtures. Every source/input and verification criterion is explicit; results do not establish arbitrary production DB/session/browser/concurrency behavior. Original and observed-batch shrunk counterexamples are retained. All dynamic imports and unresolved aliases remain unknown for static architecture checks.
