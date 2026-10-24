import { JsonReporter } from "vitest/reporters";

// The standard JSON reporter flattens hook errors into failed assertions and
// omits their type. Preserve the runner's structured provenance for RED checks.
export default class RegressionRedReporter extends JsonReporter {
  async onFinished(
    files = this.ctx.state.getFiles(),
    errors = [],
    coverageMap,
  ) {
    const tasks = [];
    const visit = (task) => {
      tasks.push({
        type: task.type,
        state: task.result?.state,
        hooks: task.result?.hooks ?? {},
        errorNames: (task.result?.errors ?? []).map((error) => error.name),
      });
      for (const child of task.tasks ?? []) visit(child);
    };
    files.forEach(visit);
    this.redEvidence = { version: 1, unhandledErrors: errors.length, tasks };
    await super.onFinished(files, errors, coverageMap);
  }

  async writeReport(report) {
    await super.writeReport(
      JSON.stringify({ ...JSON.parse(report), redEvidence: this.redEvidence }),
    );
  }
}
