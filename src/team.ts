import { randomUUID } from "node:crypto";
import { AgentBackendError, type RoleAgent } from "./agent.js";
import { createRoleAgent } from "./agent-factory.js";
import {
  ALFRED_BOOTSTRAP,
  EXECS_BOOTSTRAP,
  coderBootstrap,
  reviewerBootstrap,
} from "./prompts.js";
import {
  parseAlfredReport,
  parseCoderAssignments,
  parseExecDelegation,
  parseReviewerAssignments,
  stripControlTags,
  type ExecDelegation,
} from "./protocol.js";
import { JobBoard } from "./jobs.js";
import { loadState, saveState, type TeamState } from "./state.js";
import type { EngineId } from "./resolve-engine.js";
import type { Role } from "./roles.js";

export type { Role } from "./roles.js";
export { AgentBackendError } from "./agent.js";

const TOOL_GUIDANCE = `

You can read, write, and list files and run shell commands in the project working directory using the provided tools. Always use tools to inspect and change the codebase — do not invent file contents.`;

class AgentLane {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export interface TeamConfig {
  cwd: string;
  engine: EngineId;
  model: string;
  apiKey?: string;
  /** Legacy single-stream log (non-tmux mode). */
  onLog?: (line: string) => void;
  /** Alfred REPL pane in tmux mode. */
  onAlfredPaneLog?: (line: string) => void;
  /** Per-role log file or pane output. */
  onRoleLog?: (role: Role, line: string) => void;
  onRoleChunk?: (role: Role, text: string) => void;
  onAlfredChunk?: (text: string) => void;
}

export class AgentTeam {
  private readonly agents = new Map<Role, RoleAgent>();
  private readonly lanes = new Map<Role, AgentLane>();
  private state!: TeamState;
  readonly jobs = new JobBoard();
  private disposed = false;

  constructor(private readonly config: TeamConfig) {}

  private log(
    msg: string,
    options?: { role?: Role; pane?: boolean },
  ): void {
    const { role, pane = !role } = options ?? {};
    if (role) this.config.onRoleLog?.(role, msg);
    if (pane) {
      (this.config.onAlfredPaneLog ?? this.config.onLog)?.(msg);
    } else if (!this.config.onRoleLog) {
      this.config.onLog?.(role ? `[${role}] ${msg}` : msg);
    }
  }

  private lane(role: Role): AgentLane {
    let l = this.lanes.get(role);
    if (!l) {
      l = new AgentLane();
      this.lanes.set(role, l);
    }
    return l;
  }

  private createAgent(
    role: Role,
    system: string,
    toolsEnabled: boolean,
  ): RoleAgent {
    return createRoleAgent(this.config.engine, {
      cwd: this.config.cwd,
      model: this.config.model,
      apiKey: this.config.apiKey,
      role,
      system,
      toolsEnabled,
    });
  }

  async initialize(): Promise<void> {
    this.state = await loadState(
      this.config.cwd,
      this.config.model,
      this.config.engine,
    );

    this.agents.set(
      "alfred",
      this.createAgent("alfred", ALFRED_BOOTSTRAP, false),
    );
    this.agents.set(
      "execs",
      this.createAgent("execs", EXECS_BOOTSTRAP, false),
    );

    for (let i = 1; i <= 3; i++) {
      const coderRole = `coder-${i}` as Role;
      const reviewerRole = `reviewer-${i}` as Role;
      const toolHint =
        this.config.engine === "claude-cli" ? "" : TOOL_GUIDANCE;
      this.agents.set(
        coderRole,
        this.createAgent(coderRole, coderBootstrap(i) + toolHint, true),
      );
      this.agents.set(
        reviewerRole,
        this.createAgent(
          reviewerRole,
          reviewerBootstrap(i) + toolHint,
          true,
        ),
      );
    }

    await Promise.all(
      [...this.agents.values()].map((agent) => agent.load()),
    );

    await saveState(this.config.cwd, this.state);
    this.log("Agent team online: Alfred, Execs, 3 Coders, 3 Reviewers.", {
      pane: true,
    });
  }

  private async runSend(
    role: Role,
    agent: RoleAgent,
    message: string,
    streamToUser: boolean,
  ): Promise<string> {
    return this.lane(role).enqueue(async () => {
      const runId = randomUUID().slice(0, 8);
      this.log(`run ${runId} started`, { role });

      const streamToAlfred =
        streamToUser &&
        role === "alfred" &&
        this.config.onAlfredChunk != null;

      const text = await agent.send(
        message,
        streamToAlfred
          ? {
              onChunk: (chunk) => {
                this.config.onRoleChunk?.(role, chunk);
                this.config.onAlfredChunk?.(chunk);
              },
            }
          : this.config.onRoleChunk
            ? {
                onChunk: (chunk) => this.config.onRoleChunk?.(role, chunk),
              }
            : undefined,
      );

      this.log(`run ${runId} finished`, { role });
      await saveState(this.config.cwd, this.state);
      return text;
    });
  }

  async talkToAlfred(userMessage: string): Promise<string> {
    const alfred = this.agents.get("alfred")!;
    const context =
      this.jobs.active().length > 0
        ? `\n\n[Background jobs]\n${this.jobs.formatStatus()}`
        : "";
    const reply = await this.runSend(
      "alfred",
      alfred,
      `${userMessage}${context}`,
      true,
    );

    const delegation = parseExecDelegation(reply);
    if (delegation) {
      void this.delegateToExecs(delegation);
    }

    return stripControlTags(reply);
  }

  private async delegateToExecs(task: ExecDelegation): Promise<void> {
    const job = this.jobs.add("execs", `Execs: ${task.summary}`);
    this.log(`→ Delegating to Execs: ${task.summary}`, {
      role: "execs",
      pane: true,
    });

    try {
      this.jobs.markRunning(job.id);
      const execs = this.agents.get("execs")!;
      const payload = [
        "[TASK_FROM_ALFRED]",
        `Summary: ${task.summary}`,
        `Priority: ${task.priority ?? "normal"}`,
        "",
        task.task,
      ].join("\n");

      const response = await this.runSend("execs", execs, payload, false);
      await this.handleExecsResponse(response, 0);
      this.jobs.markFinished(job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jobs.markFinished(job.id, msg);
      await this.notifyAlfred(
        `Execs task "${task.summary}" failed: ${msg}`,
      );
    }
  }

  private async handleExecsResponse(
    response: string,
    depth = 0,
  ): Promise<void> {
    if (depth > 12) {
      await this.notifyAlfred(
        "[TEAM_UPDATE] Execs iteration limit reached. Ask Alfred for a manual status check.",
      );
      return;
    }

    const coders = parseCoderAssignments(response);
    const reviewers = parseReviewerAssignments(response);
    const report = parseAlfredReport(response);

    const coderPromises = coders.map((a) => this.runCoder(a.id, a.instructions));
    const reviewerPromises = reviewers.map((a) =>
      this.runReviewer(a.id, a.instructions),
    );

    if (coderPromises.length > 0) {
      this.log(`→ Execs assigned ${coderPromises.length} Coder job(s)`, {
        role: "execs",
        pane: true,
      });
      const results = await Promise.allSettled(coderPromises);
      const summary = results
        .map((r, i) => {
          const id = coders[i]!.id;
          if (r.status === "fulfilled") return `Coder ${id}:\n${r.value}`;
          return `Coder ${id} ERROR: ${r.reason}`;
        })
        .join("\n\n---\n\n");

      const execs = this.agents.get("execs")!;
      const followUp = await this.runSend(
        "execs",
        execs,
        `[CODER_RESULTS]\n${summary}\n\nAssign Reviewers if ready, or send revised Coder tasks.`,
        false,
      );
      await this.handleExecsResponse(followUp, depth + 1);
      return;
    }

    if (reviewerPromises.length > 0) {
      this.log(`→ Execs assigned ${reviewerPromises.length} Reviewer job(s)`, {
        role: "execs",
        pane: true,
      });
      const results = await Promise.allSettled(reviewerPromises);
      const summary = results
        .map((r, i) => {
          const id = reviewers[i]!.id;
          if (r.status === "fulfilled") return `Reviewer ${id}:\n${r.value}`;
          return `Reviewer ${id} ERROR: ${r.reason}`;
        })
        .join("\n\n---\n\n");

      const execs = this.agents.get("execs")!;
      const followUp = await this.runSend(
        "execs",
        execs,
        `[REVIEWER_RESULTS]\n${summary}\n\nIssue new Coder tasks or report to Alfred.`,
        false,
      );
      await this.handleExecsResponse(followUp, depth + 1);
      return;
    }

    if (report) {
      await this.notifyAlfred(
        [
          "[TEAM_UPDATE from Execs]",
          `Status: ${report.status}`,
          `Summary: ${report.summary}`,
          report.details,
          report.next_steps ? `Next: ${report.next_steps}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } else if (coders.length === 0 && reviewers.length === 0) {
      const visible = stripControlTags(response);
      if (visible) {
        await this.notifyAlfred(`[TEAM_UPDATE from Execs]\n${visible}`);
      }
    }
  }

  private async runCoder(id: 1 | 2 | 3, instructions: string): Promise<string> {
    const role = `coder-${id}` as Role;
    const job = this.jobs.add("coder", `Coder ${id}`);
    this.jobs.markRunning(job.id);
    try {
      const agent = this.agents.get(role)!;
      const text = await this.runSend(
        role,
        agent,
        `[INSTRUCTIONS_FROM_EXECS]\n${instructions}`,
        false,
      );
      this.jobs.markFinished(job.id);
      this.log(`✓ finished`, { role });
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jobs.markFinished(job.id, msg);
      throw err;
    }
  }

  private async runReviewer(
    id: 1 | 2 | 3,
    instructions: string,
  ): Promise<string> {
    const role = `reviewer-${id}` as Role;
    const job = this.jobs.add("reviewer", `Reviewer ${id}`);
    this.jobs.markRunning(job.id);
    try {
      const agent = this.agents.get(role)!;
      const text = await this.runSend(
        role,
        agent,
        `[REVIEW_BRIEF_FROM_EXECS]\n${instructions}`,
        false,
      );
      this.jobs.markFinished(job.id);
      this.log(`✓ finished`, { role });
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jobs.markFinished(job.id, msg);
      throw err;
    }
  }

  private async notifyAlfred(message: string): Promise<void> {
    const job = this.jobs.add("alfred-notify", "Alfred team update");
    this.jobs.markRunning(job.id);
    try {
      const alfred = this.agents.get("alfred")!;
      await this.runSend("alfred", alfred, message, false);
      this.jobs.markFinished(job.id);
      this.log(
        "[Alfred received team update — ask him for a status summary]",
        { pane: true },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.jobs.markFinished(job.id, msg);
    }
  }

  statusText(): string {
    return this.jobs.formatStatus();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const agent of this.agents.values()) {
      agent.close();
    }
  }
}
