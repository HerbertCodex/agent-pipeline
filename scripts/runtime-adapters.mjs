const CLAUDE_CODE_ROLES = {
  implementer: {
    description: "Implementer - pins acceptance criteria as red tests, then writes the smallest implementation that turns them green.",
    tools: "Read, Glob, Grep, Bash, WebFetch, WebSearch, TodoWrite, Skill, ListMcpResourcesTool, ReadMcpResourceTool, Write, Edit, NotebookEdit",
  },
  orchestrator: {
    description: "Orchestrates transitions, validates handoffs, persists the store, schedules work and escalates to the operator.",
    tools: "Read, Glob, Grep, Bash, WebFetch, WebSearch, TodoWrite, Skill, ListMcpResourcesTool, ReadMcpResourceTool, Write, Edit, NotebookEdit, Agent",
  },
  product: {
    description: "Product Manager - gathers requirements, proposes specs and cohesive dependency-ordered issues, and prepares the PR.",
    tools: "Read, Glob, Grep, Bash, WebFetch, WebSearch, TodoWrite, Skill, ListMcpResourcesTool, ReadMcpResourceTool",
  },
  qa: {
    description: "QA - read-only gatekeeper that verifies criteria, evidence, security and architecture, then routes a structured result.",
    tools: "Read, Glob, Grep, Bash, WebFetch, WebSearch, TodoWrite, Skill, ListMcpResourcesTool, ReadMcpResourceTool",
  },
};

/**
 * Returns the prompt adapter selected by the host project.
 *
 * Existing projects used `.claude/agents` before adapters were explicit, so
 * that path remains a compatibility signal. New projects should declare the
 * adapter and can render the same canonical role body for any harness.
 *
 * @param config - project configuration
 * @returns `claude-code` or `portable`
 */
export function promptAdapter(config) {
  const configured = config.agent_runtime?.prompt_adapter;
  if (configured == null) {
    return String(config.prompts_dir ?? "").includes(".claude/") ? "claude-code" : "portable";
  }
  if (!["claude-code", "portable"].includes(configured)) {
    throw new Error(`agent_runtime.prompt_adapter unknown: ${configured}`);
  }
  return configured;
}

/**
 * Removes the optional YAML metadata envelope from a canonical role prompt.
 *
 * The body is the cross-harness contract. Metadata such as `tools` belongs
 * to the adapter because every agent CLI has a different permission format.
 *
 * @param source - canonical prompt source
 * @returns prompt body without the YAML envelope
 */
export function promptBody(source) {
  if (!source.startsWith("---\n")) return source;
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) throw new Error("prompt frontmatter is not closed");
  return source.slice(end + 5).replace(/^\n+/, "");
}

/**
 * Renders one canonical role prompt for a harness.
 *
 * @param source - prompt after project variables are resolved
 * @param adapter - selected adapter name
 * @returns harness-facing prompt
 */
export function adaptPrompt(source, adapter, role = null) {
  if (adapter === "claude-code") {
    const metadata = CLAUDE_CODE_ROLES[role];
    if (metadata == null) throw new Error(`Claude Code role metadata missing: ${role}`);
    return `---\nname: ${role}\ndescription: ${metadata.description}\ntools: ${metadata.tools}\nmodel: inherit\n---\n\n${promptBody(source)}`;
  }
  if (adapter === "portable") return promptBody(source);
  throw new Error(`prompt adapter unknown: ${adapter}`);
}

/**
 * Whether this adapter owns the legacy root `CLAUDE.md` entry point.
 *
 * @param adapter - selected adapter name
 * @returns true only for Claude Code
 */
export function rendersClaudeEntry(adapter) {
  return adapter === "claude-code";
}
