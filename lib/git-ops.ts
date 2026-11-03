// Host-side git writes and reads for Source Control. Every user value is either a
// workspace path (checked, then passed after `--`) or a branch name checked by
// `git check-ref-format`, so nothing can be read as an option.
import { resolveWithinRoot } from "./paths.js";
import { run } from "./run.js";

async function git(root: string, args: string[], input?: string) {
  const result = await run("git", args, { cwd: root, input, timeoutMs: 60_000 });
  if (result.code !== 0) throw new Error(result.stderr.trim().split("\n").slice(-3).join(" ") || `git ${args[0]} failed`);
  return result.stdout;
}

function checkedPaths(root: string, paths: readonly string[]): string[] {
  if (paths.length === 0) throw new Error("No files given");
  for (const path of paths) resolveWithinRoot(root, path);
  // `./` keeps a path that starts with a dash or colon from being parsed as anything else.
  return paths.map((path) => `./${path.replace(/^\.?\/+/, "")}`);
}

async function hasHead(root: string): Promise<boolean> {
  return (await run("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: root })).code === 0;
}

/** A file's content at HEAD or in the index; null when it does not exist there. */
export async function showFile(root: string, path: string, at: "HEAD" | "index"): Promise<string | null> {
  const [relative] = checkedPaths(root, [path]);
  const spec = at === "HEAD" ? `HEAD:${relative}` : `:${relative}`;
  const result = await run("git", ["show", spec], { cwd: root, timeoutMs: 30_000 });
  return result.code === 0 ? result.stdout : null;
}

export async function stage(root: string, paths: readonly string[]): Promise<void> {
  await git(root, ["add", "-A", "--", ...checkedPaths(root, paths)]);
}

export async function unstage(root: string, paths: readonly string[]): Promise<void> {
  const relative = checkedPaths(root, paths);
  if (await hasHead(root)) await git(root, ["restore", "--staged", "--", ...relative]);
  else await git(root, ["rm", "--cached", "-r", "-q", "--", ...relative]);
}

export async function commit(root: string, message: string, all: boolean): Promise<{ summary: string }> {
  if (message.trim() === "") throw new Error("Write a commit message first");
  const out = await git(root, ["commit", ...(all ? ["-a"] : []), "-F", "-"], message);
  return { summary: out.trim().split("\n")[0] ?? "" };
}

export async function branches(root: string): Promise<{ current: string | null; local: string[]; remote: string[] }> {
  const current = (await run("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd: root })).stdout.trim() || null;
  const list = async (ref: string) =>
    (await git(root, ["for-each-ref", "--format=%(refname:short)", ref])).split("\n").filter((name) => name && !name.endsWith("/HEAD"));
  return { current, local: await list("refs/heads"), remote: await list("refs/remotes") };
}

async function checkBranchName(root: string, name: string): Promise<void> {
  if (name.startsWith("-") || (await run("git", ["check-ref-format", "--branch", name], { cwd: root })).code !== 0) {
    throw new Error(`Not a valid branch name: ${name}`);
  }
}

/** Switch to a local branch, track a remote one ("origin/x"), or create one. */
export async function switchBranch(root: string, name: string, create: boolean): Promise<void> {
  await checkBranchName(root, name);
  if (create) return void (await git(root, ["switch", "-c", name]));
  const { local, remote } = await branches(root);
  if (local.includes(name)) return void (await git(root, ["switch", name]));
  if (remote.includes(name)) return void (await git(root, ["switch", "--track", name]));
  throw new Error(`No branch named ${name}`);
}

/**
 * Discard working-tree changes: tracked files go back to their index version,
 * untracked files are deleted (git clean, files only).
 */
export async function discard(root: string, tracked: readonly string[], untracked: readonly string[]): Promise<void> {
  if (tracked.length > 0) await git(root, ["restore", "--worktree", "--", ...checkedPaths(root, tracked)]);
  if (untracked.length > 0) await git(root, ["clean", "-f", "-q", "--", ...checkedPaths(root, untracked)]);
}

export interface Stash {
  ref: string;
  message: string;
}

export async function stashList(root: string): Promise<Stash[]> {
  const out = await git(root, ["stash", "list", "--format=%gd%x00%s"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, message] = line.split("\0");
      return { ref: ref!, message: message ?? "" };
    });
}

export async function stash(
  root: string,
  action: "push" | "list" | "apply" | "pop" | "drop",
  options: { message?: string; ref?: string } = {},
): Promise<Stash[]> {
  if (action === "push") {
    await git(root, ["stash", "push", "--include-untracked", ...(options.message ? ["-m", options.message] : [])]);
  } else if (action !== "list") {
    const ref = options.ref ?? "stash@{0}";
    if (!/^stash@\{\d+\}$/.test(ref)) throw new Error(`Not a stash: ${ref}`);
    await git(root, ["stash", action, ref]);
  }
  return stashList(root);
}
