import {
  Agent,
  CursorAgentError,
  type SDKAgent,
  type SettingSource,
} from "@cursor/sdk";
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
import { collectAssistantText, pipeAssistantStream } from "./stream.js";
import { loadState, saveState, type TeamState } from "./state.js";
import type { Role } from "./roles.js";

export type { Role } from "./roles.js";

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
  apiKey: string;
  model: string;
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
  private readonly agents = new Map<Role, SDKAgent>();
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

  private agentOptions(name: string) {
    return {
      apiKey: this.config.apiKey,
      model: { id: this.config.model },
      name,
      local: {
        cwd: this.config.cwd,
        settingSources: [] as SettingSource[],
      },
    };
  }

  async initialize(): Promise<void> {
    this.state = await loadState(this.config.cwd, this.config.model);

    this.agents.set("alfred", await this.openRole("alfred", "alfred", () => this.state.agents.alfred));
    this.agents.set("execs", await this.openRole("execs", "execs", () => this.state.agents.execs));

    for (let i = 1; i <= 3; i++) {
      const coderRole = `coder-${i}` as Role;
      const reviewerRole = `reviewer-${i}` as Role;
      this.agents.set(
        coderRole,
        await this.openRole(coderRole, `Coder ${i}`, () => this.state.agents.coders[i - 1]),
      );
      this.agents.set(
        reviewerRole,
        await this.openRole(reviewerRole, `Reviewer ${i}`, () => this.state.agents.reviewers[i - 1]),
      );
    }

    await this.bootstrapAll();
    await saveState(this.config.cwd, this.state);
    this.log("Agent team online: Alfred, Execs, 3 Coders, 3 Reviewers.", {
      pane: true,
    });
  }

  private async openRole(
    role: Role,
    displayName: string,
    getId: () => string | undefined,
  ): Promise<SDKAgent> {
    const existing = getId();
    if (existing) {
      try {
        return await Agent.resume(existing, this.agentOptions(displayName));
      } catch {
        this.log(`Could not resume ${displayName}; creating fresh agent.`, {
          role,
        });
      }
    }
    return Agent.create(this.agentOptions(displayName));
  }

  private persistId(role: Role, agentId: string): void {
    switch (role) {
      case "alfred":
        this.state.agents.alfred = agentId;
        break;
      case "execs":
        this.state.agents.execs = agentId;
        break;
      case "coder-1":
        this.state.agents.coders[0] = agentId;
        break;
      case "coder-2":
        this.state.agents.coders[1] = agentId;
        break;
      case "coder-3":
        this.state.agents.coders[2] = agentId;
        break;
      case "reviewer-1":
        this.state.agents.reviewers[0] = agentId;
        break;
      case "reviewer-2":
        this.state.agents.reviewers[1] = agentId;
        break;
      case "reviewer-3":
        this.state.agents.reviewers[2] = agentId;
        break;
    }
  }

  private async bootstrapAll(): Promise<void> {
    const alfred = this.agents.get("alfred")!;
    if (!this.state.bootstrapped.alfred) {
      await this.runSend("alfred", alfred, ALFRED_BOOTSTRAP, false);
      this.state.bootstrapped.alfred = true;
      this.persistId("alfred", alfred.agentId);
    }

    const execs = this.agents.get("execs")!;
    if (!this.state.bootstrapped.execs) {
      await this.runSend("execs", execs, EXECS_BOOTSTRAP, false);
      this.state.bootstrapped.execs = true;
      this.persistId("execs", execs.agentId);
    }

    for (let i = 1; i <= 3; i++) {
      const coderRole = `coder-${i}` as Role;
      if (!this.state.bootstrapped.coders[i - 1]) {
        const agent = this.agents.get(coderRole)!;
        await this.runSend(coderRole, agent, coderBootstrap(i), false);
        this.state.bootstrapped.coders[i - 1] = true;
        this.persistId(coderRole, agent.agentId);
      }
      const reviewerRole = `reviewer-${i}` as Role;
      if (!this.state.bootstrapped.reviewers[i - 1]) {
        const agent = this.agents.get(reviewerRole)!;
        await this.runSend(reviewerRole, agent, reviewerBootstrap(i), false);
        this.state.bootstrapped.reviewers[i - 1] = true;
        this.persistId(reviewerRole, agent.agentId);
      }
    }
  }

  private async runSend(
    role: Role,
    agent: SDKAgent,
    message: string,
    streamToUser: boolean,
  ): Promise<string> {
    return this.lane(role).enqueue(async () => {
      const run = await agent.send(message);
      this.log(`run ${run.id} started`, { role });
      const shouldStream =
        this.config.onRoleChunk != null ||
        (streamToUser && this.config.onAlfredChunk != null);
      let text: string;
      if (shouldStream) {
        text = await pipeAssistantStream(run.stream(), (chunk) => {
          this.config.onRoleChunk?.(role, chunk);
          if (streamToUser && role === "alfred") {
            this.config.onAlfredChunk?.(chunk);
          }
        });
      } else {
        text = await collectAssistantText(run.stream());
      }
      const result = await run.wait();
      if (result.status === "error") {
        throw new Error(`${role} run failed (${result.id})`);
      }
      this.log(`run ${run.id} finished`, { role });
      this.persistId(role, agent.agentId);
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

export function resolveApiKey(): string | undefined {
  return process.env.CURSOR_API_KEY?.trim() || undefined;
}

export async function resolveModel(apiKey: string): Promise<string> {
  const env = process.env.AGENT_TEAM_MODEL?.trim();
  if (env) return env;
  try {
    const models = await import("@cursor/sdk").then((m) =>
      m.Cursor.models.list({ apiKey }),
    );
    const preferred =
      models.find((x) => x.id === "composer-2.5") ??
      models.find((x) => x.aliases?.includes("composer-latest")) ??
      models[0];
    return preferred?.id ?? "composer-2.5";
  } catch {
    return "composer-2.5";
  }
}

export { CursorAgentError };
