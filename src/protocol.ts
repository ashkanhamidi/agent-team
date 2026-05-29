export interface ExecDelegation {
  summary: string;
  task: string;
  priority?: string;
}

export interface AlfredReport {
  status: string;
  summary: string;
  details: string;
  next_steps?: string;
}

export interface CoderAssignment {
  id: 1 | 2 | 3;
  instructions: string;
}

export interface ReviewerAssignment {
  id: 1 | 2 | 3;
  instructions: string;
}

function extractTag(text: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

export function parseExecDelegation(text: string): ExecDelegation | null {
  const blocks = extractTag(text, "delegate-execs");
  if (blocks.length === 0) return null;
  try {
    const parsed = JSON.parse(blocks[blocks.length - 1]!) as ExecDelegation;
    if (!parsed.summary || !parsed.task) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseAlfredReport(text: string): AlfredReport | null {
  const blocks = extractTag(text, "report-alfred");
  if (blocks.length === 0) return null;
  try {
    return JSON.parse(blocks[blocks.length - 1]!) as AlfredReport;
  } catch {
    return null;
  }
}

export function parseCoderAssignments(text: string): CoderAssignment[] {
  const re = /<assign-coder\s+id=["']?([123])["']?\s*>([\s\S]*?)<\/assign-coder>/gi;
  const out: CoderAssignment[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]) as 1 | 2 | 3;
    out.push({ id, instructions: m[2]!.trim() });
  }
  return out;
}

export function parseReviewerAssignments(text: string): ReviewerAssignment[] {
  const re =
    /<assign-reviewer\s+id=["']?([123])["']?\s*>([\s\S]*?)<\/assign-reviewer>/gi;
  const out: ReviewerAssignment[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]) as 1 | 2 | 3;
    out.push({ id, instructions: m[2]!.trim() });
  }
  return out;
}

export function stripControlTags(text: string): string {
  return text
    .replace(/<delegate-execs>[\s\S]*?<\/delegate-execs>/gi, "")
    .replace(/<report-alfred>[\s\S]*?<\/report-alfred>/gi, "")
    .replace(/<assign-coder[\s\S]*?<\/assign-coder>/gi, "")
    .replace(/<assign-reviewer[\s\S]*?<\/assign-reviewer>/gi, "")
    .trim();
}
