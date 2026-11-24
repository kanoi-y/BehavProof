# @behavproof/adapter-model-test

Replays model traces against an implementation through a project-supplied driver and records BehavProof evidence.

@behavproof/adapter-model-test is available on the public npm registry. Requires Node.js 24.x.

```sh
npm install --ignore-scripts @behavproof/adapter-model-test
```

Passing evidence applies only to its authenticated source, approved obligations, and bounded execution scope. Run candidate tests and optional model drivers in isolated workers without credentials. Keep publishing credentials on a separate trusted host. See the [security boundaries](https://github.com/kanoi-y/BehavProof/blob/main/docs/security.md).

### Allowed and rejected operations

A Quint model can declare the string state variable `replayOutcome` and set it to `"allowed"` or `"rejected"` in every recorded action, including initialization. Replay reads that variable as the expected outcome. The remaining model variables form the expected state snapshot.

For those traces, the Driver awaits the actual implementation call and returns `"allowed"` or `"rejected"`. It maps declared domain rejections and lets unexpected exceptions propagate. Its `observe` method returns the protected state and any required effects represented in the model. Replay compares the outcome and snapshot, records calls made during dispatch, and reports an unknown comparison when a call, outcome, or required observation is unavailable. Models without `replayOutcome` continue to compare state snapshots.

The source is publicly viewable on GitHub. The package is marked `UNLICENSED` and is distributed without an open-source license.
