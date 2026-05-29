export type JobKind = "execs" | "coder" | "reviewer" | "alfred-notify";
export type JobStatus = "queued" | "running" | "finished" | "error";

export interface Job {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  createdAt: number;
  finishedAt?: number;
  error?: string;
}

let seq = 0;

export class JobBoard {
  private jobs = new Map<string, Job>();

  add(kind: JobKind, label: string): Job {
    const job: Job = {
      id: `job-${++seq}`,
      kind,
      label,
      status: "queued",
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  markRunning(id: string): void {
    const j = this.jobs.get(id);
    if (j) j.status = "running";
  }

  markFinished(id: string, error?: string): void {
    const j = this.jobs.get(id);
    if (!j) return;
    j.status = error ? "error" : "finished";
    j.finishedAt = Date.now();
    if (error) j.error = error;
  }

  active(): Job[] {
    return [...this.jobs.values()].filter(
      (j) => j.status === "queued" || j.status === "running",
    );
  }

  recent(limit = 12): Job[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  formatStatus(): string {
    const active = this.active();
    if (active.length === 0) return "No background jobs running.";
    return active
      .map((j) => `  • [${j.status}] ${j.label} (${j.id})`)
      .join("\n");
  }
}
