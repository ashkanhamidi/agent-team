export const ROLES = [
  "alfred",
  "execs",
  "coder-1",
  "coder-2",
  "coder-3",
  "reviewer-1",
  "reviewer-2",
  "reviewer-3",
] as const;

export type Role = (typeof ROLES)[number];

/** Roles shown in dedicated tmux windows (Alfred uses the interactive REPL window). */
export const TMUX_TAIL_ROLES = ROLES.filter((r) => r !== "alfred");

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
