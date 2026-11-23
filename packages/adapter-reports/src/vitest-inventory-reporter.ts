import { writeFile } from 'node:fs/promises';
import type { Reporter, TestModule, TestRunEndReason, TestSpecification } from 'vitest/node';

export default class VitestInventoryReporter implements Reporter {
  private scheduledIds: string[] = [];

  onTestRunStart(specifications: readonly TestSpecification[]): void {
    this.scheduledIds = specifications.map(specification => specification.taskId);
  }

  async onTestRunEnd(
    modules: readonly TestModule[],
    errors: readonly unknown[],
    reason: TestRunEndReason,
  ): Promise<void> {
    const output = process.env.BEHAVPROOF_TEST_INVENTORY;
    if (!output) return;

    const files = new Set<string>();
    const moduleIds = new Set<string>();
    const suiteIds = new Set<string>();
    const testIds = new Set<string>();
    let complete = modules.length > 0 && reason !== 'interrupted' && errors.length === 0;

    for (const module of modules) {
      if (files.has(module.moduleId) || module.errors().length > 0 || module.state() === 'queued') {
        complete = false;
      }
      files.add(module.moduleId);
      moduleIds.add(module.id);

      // Vitest JSON counts both file-level suites and every nested describe block.
      for (const suite of [module, ...module.children.allSuites()]) {
        if (suiteIds.has(suite.id)) complete = false;
        suiteIds.add(suite.id);
      }
      for (const test of module.children.allTests()) {
        if (testIds.has(test.id) || test.result().state === 'pending') complete = false;
        testIds.add(test.id);
      }
    }

    complete &&= testIds.size > 0 && moduleIds.size === this.scheduledIds.length &&
      new Set(this.scheduledIds).size === moduleIds.size &&
      this.scheduledIds.every(id => moduleIds.has(id));

    await writeFile(output, JSON.stringify({
      suiteCount: suiteIds.size,
      testCount: testIds.size,
      files: [...files].sort(),
      suiteIds: [...suiteIds].sort(),
      testIds: [...testIds].sort(),
      complete,
    }) + '\n');
  }
}
