# Repository boundaries

The canonical public project is [kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof). Product packages, CLI, tests, examples, templates, documentation and three-platform product CI live at this repository's root. Its initial public history is a reviewed source snapshot; private local development history, source specifications, execution plans, credentials and working logs are not published. They remain local.

A consumer application is separate from this product repository. It must not contain a vendored BehavProof implementation. Consumer workflows explicitly check out `kanoi-y/BehavProof` at a full protected `BEHAVPROOF_SDK_SHA`, build it in `sdk/`, and pass only the separately staged public SDK to isolated candidate execution. Workflow authority and credentials remain separately protected in the consumer repository.

A consumer integration payload contains only consumer workflow files and reviewed verification data. It never copies product packages/tests/root CI or opens/merges a PR. Whole-consumer quality and live protected enforcement remain separately required. The enforcement-probe example shows a minimal consumer integration.

Product CI runs in BehavProof. Future consumer changes are limited to application-specific contracts/configuration and thin integration, with separate human review and protected provisioning when required.
