# Security policy

The initial 0.1.0 release is in preparation. Until it is published, use a verified pinned source commit; no npm version is claimed as released here.

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/kanoi-y/BehavProof/security/advisories/new). Include the affected commit/version, reproduction, trust assumptions, and expected/observed behavior. Use synthetic credentials and redact personal or customer data. Do not submit live tokens or private keys.

Do not disclose an unpatched exploit or sensitive evidence in a public Issue or PR. Acknowledgment and fixes are handled on a best-effort basis; no response-time SLA is promised.

Read [security boundaries](../docs/security.md) before deployment. Candidate code must execute in a credential-free isolated worker. Maintain separately protected verifier source, approval authority, publisher credentials and issuer-bound required checks. A passing report does not prove the safety of arbitrary code or the honesty of its approved specification.
