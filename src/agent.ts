import type { Role } from "./roles.js";

export class AgentBackendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AgentBackendError";
  }
}

export interface RoleAgent {
  readonly role: Role;
  load(): Promise<void>;
  send(
    userMessage: string,
    streamOpts?: { onChunk?: (text: string) => void },
  ): Promise<string>;
  close(): void;
}

export interface RoleAgentFactoryOptions {
  cwd: string;
  model: string;
  role: Role;
  system: string;
  toolsEnabled: boolean;
  apiKey?: string;
}
