import type { CompileApiResult, Sample } from "./types";

export type SourceAvailability = "available" | "restorable" | "missing" | "not-selected";
export type CompileStatus = "not-compiled" | "current" | "stale";

export type LiveTask = {
  documentName: string | null;
  taskLabel: string;
  budget: number;
  sourceAvailability: SourceAvailability;
};

export type CompiledTaskSnapshot = {
  documentName: string | null;
  taskLabel: string;
  budget: number;
  sourceAvailability: SourceAvailability;
};

export type TaskSummaryView = {
  live: LiveTask;
  compiled: CompiledTaskSnapshot | null;
  compileStatus: CompileStatus;
};

export type TaskSummarySource = {
  file: File | null;
  filePicked: string;
  sampleKey: string | null;
  samples: Sample[];
  task: string;
  budget: number;
  compile: CompileApiResult | null;
  compiledTask: string | null;
  compiledBudget: number | null;
};

export function selectDocumentName(
  source: Pick<TaskSummarySource, "file" | "filePicked" | "sampleKey" | "samples">
) {
  const sampleName = source.sampleKey
    ? source.samples.find((sample) => sample.key === source.sampleKey)?.nm
    : null;
  return (sampleName ?? source.file?.name ?? source.filePicked.trim()) || null;
}

export function selectTaskLabel(task: string): string {
  return task.trim();
}

export function selectBudget(budget: number): number {
  return budget;
}

export function selectSourceAvailability(
  source: Pick<TaskSummarySource, "file" | "filePicked" | "sampleKey">
): SourceAvailability {
  if (source.file) return "available";
  if (source.sampleKey) return "restorable";
  if (source.filePicked.trim()) return "missing";
  return "not-selected";
}

export function selectCompileStatus(
  source: Pick<TaskSummarySource, "compile" | "task" | "budget" | "compiledTask" | "compiledBudget">
): CompileStatus {
  if (!source.compile || source.compiledTask === null || source.compiledBudget === null) {
    return "not-compiled";
  }
  const stale =
    selectTaskLabel(source.task) !== selectTaskLabel(source.compiledTask) ||
    source.budget !== source.compiledBudget;
  return stale ? "stale" : "current";
}

export function selectTaskSummary(source: TaskSummarySource): TaskSummaryView {
  const documentName = selectDocumentName(source);
  const sourceAvailability = selectSourceAvailability(source);
  const compiled =
    source.compile && source.compiledTask !== null && source.compiledBudget !== null
      ? {
          documentName,
          taskLabel: selectTaskLabel(source.compiledTask),
          budget: selectBudget(source.compiledBudget),
          sourceAvailability,
        }
      : null;

  return {
    live: {
      documentName,
      taskLabel: selectTaskLabel(source.task),
      budget: selectBudget(source.budget),
      sourceAvailability,
    },
    compiled,
    compileStatus: selectCompileStatus(source),
  };
}
