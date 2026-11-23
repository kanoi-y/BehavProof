# Schema compatibility and deployment

Project configuration, approvals, gate reports, evidence envelopes, enrollment, trust roots and generated behavior documents use schema version 2. Policy files retain schema version 1 with `profileVersion: "2"`. Check the installed CLI's bundled schema for each artifact.

Protected Quality CI uses the native enrollment and trust root formats. `ci enroll` binds the deployment and its specification inventory to a reviewed Git commit. The publisher creates the root from the enrollment, active registry and producer evidence. Ordinary Jest and Vitest runs use an empty specification inventory.

The native report and its test receipt are distinct artifacts. The receipt binds the runner, version, invocation and suite or test inventory to the native JSON digest. The verifier selects the supported format from the protected runner. Execution manifests and receipts each have their own schema version.

The packaged JSON schemas describe structure. Approval, identity and hash checks also run in the verifier. To cut over an existing deployment, enroll a reviewed native configuration with the pinned SDK, initialize its protected registry, and verify the new gate before retiring the earlier required check.

Keep the SDK revision, enrollment digest and producer artifacts with the resulting evidence. The policy or specification digest identifies its input data. The SDK revision identifies the verifier that interpreted it.

See [protected trust roots](trust-root.md) and [formal verification and registration](formal.ja.md).
