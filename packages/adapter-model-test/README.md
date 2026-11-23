# @behavproof/adapter-model-test

BehavProof 0.2.0 public preview distribution. Requires Node.js 24.x.

After publication, install from the public npm registry:

```sh
npm install --ignore-scripts @behavproof/adapter-model-test@0.2.0
```

See the [Japanese deployment guide](https://github.com/kanoi-y/BehavProof/blob/main/docs/protected-github-deployment.ja.md) and [security boundaries](https://github.com/kanoi-y/BehavProof/blob/main/docs/security.md).

Passing evidence applies only to its authenticated source, approved obligations and bounded execution scope. Execute candidate tests and optional model Drivers only in credential-free isolated workers. Keep publishing credentials in a separate trusted host.

### Allowed and rejected operations

A Quint model can declare the string state variable `replayOutcome` and set it to `"allowed"` or `"rejected"` in every recorded action, including initialization. Replay reads that variable as the expected outcome. The remaining model variables form the expected state snapshot.

For those traces, the Driver awaits the actual implementation call and returns `"allowed"` or `"rejected"`. It maps declared domain rejections and lets unexpected exceptions propagate. Its `observe` method returns the protected state and any required effects represented in the model. Replay compares the outcome and snapshot, records calls made during dispatch, and reports an unknown comparison when a call, outcome, or required observation is unavailable. Models without `replayOutcome` continue to compare state snapshots.

No open-source license is granted (UNLICENSED). Source is public; npm packages will be public after publication. The next dist-tag identifies the preview channel; it does not restrict access.
