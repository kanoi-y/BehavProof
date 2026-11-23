import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

type Assertion = {
  title: string;
  ancestorTitles: string[];
  invocations?: number;
};

type FileResult = {
  testFilePath: string;
  testResults: Assertion[];
  testExecError?: unknown;
  leaks?: boolean;
};

type RunResult = {
  numTotalTests: number;
  numTotalTestSuites: number;
  numRuntimeErrorTestSuites: number;
  wasInterrupted?: boolean;
  runExecError?: unknown;
};

function identity(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

class JestInventoryReporter {
  private files = new Map<string, string[]>();
  private sawIncompleteResult = false;

  onRunStart(): void {
    this.files.clear();
    this.sawIncompleteResult = false;
  }

  onTestResult(_test: unknown, result: FileResult): void {
    const { testFilePath: file, testResults } = result;
    if (this.files.has(file)) {
      this.sawIncompleteResult = true;
      return;
    }
    if (result.testExecError || result.leaks || testResults.length === 0) {
      this.sawIncompleteResult = true;
    }

    const occurrences = new Map<string, number>();
    const testIds = testResults.map(assertion => {
      const { ancestorTitles, title, invocations } = assertion;
      const key = JSON.stringify([ancestorTitles, title]);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      if (occurrence > 0 || (invocations ?? 1) > 1) this.sawIncompleteResult = true;
      return identity([file, ancestorTitles, title, occurrence]);
    });
    this.files.set(file, testIds);
  }

  async onRunComplete(_contexts: unknown, result: RunResult): Promise<void> {
    const output = process.env.BEHAVPROOF_TEST_INVENTORY;
    if (!output) return;

    const files = [...this.files.keys()].sort();
    // Jest counts one suite per file. Describe names are part of each test's identity.
    const suiteIds = files.map(file => identity([file]));
    const testIds = files.flatMap(file => this.files.get(file)!);
    const complete = files.length > 0 && testIds.length > 0 && !this.sawIncompleteResult &&
      !result.wasInterrupted && !result.runExecError && result.numRuntimeErrorTestSuites === 0 &&
      files.length === result.numTotalTestSuites && testIds.length === result.numTotalTests;

    await writeFile(output, JSON.stringify({
      suiteCount: suiteIds.length,
      testCount: testIds.length,
      files,
      suiteIds,
      testIds,
      complete,
    }) + '\n');
  }
}

export = JestInventoryReporter;
