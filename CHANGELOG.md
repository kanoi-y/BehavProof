# Changelog

## 0.1.0 — public preview

Initial release scope. Publication status and the exact tagged source commit are recorded in GitHub Releases; the preview uses npm’s next channel.

- Eight packages: core, report adapters, Contract registry, Vitest integration, GitHub authority/publisher, CLI, and two optional formal adapters.
- Node.js 24.x and single-package Vitest 5.1.0 integration. Schemas, policy presets and protected GitHub workflow templates are included with the CLI.
- Separate evidence for declared Contracts, executed comparisons, production target calls, same-callback canaries and authenticated human approval. Required missing evidence blocks gate mode.
- Explicit Quint 0.33.1 / optional Apalache 0.62.4 model checks and Driver-based replay, bounded to configured models, sources, properties and traces.
- Fix GitHub API encoded-dot URL normalization escaping the configured repository boundary.
- Inspect real npm archives, enforce package entrypoints and internal versions, pin registry routing, disable lifecycle scripts, and verify publication access and SHA-512.

Passing checks do not prove arbitrary program correctness, honest approved specifications or safe candidate code. Candidate execution needs isolated credential-free workers; publisher credentials and gate App identity require separate protection. See the security documentation and Japanese release/deployment guides.
