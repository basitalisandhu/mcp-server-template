/**
 * Bounded file access: every path a tool receives is resolved inside an allowlisted root.
 *
 * A model-supplied path is untrusted input. Prompt injection can make the model ask for
 * `../../.ssh/id_rsa` or for a symlink that points outside the project. `resolveInside` resolves
 * the real path (following symlinks) and checks the result still starts with the allowed root.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export class PathDeniedError extends Error {
  override readonly name = "PathDeniedError";
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve `requested` against the allowed roots and return the real, absolute path.
 * Throws PathDeniedError when the path escapes every root, including through symlinks.
 */
export async function resolveInside(allowedRoots: readonly string[], requested: string): Promise<string> {
  if (allowedRoots.length === 0) {
    throw new PathDeniedError("file access is disabled: no allowed directories configured");
  }
  if (requested.includes("\0")) {
    throw new PathDeniedError("path contains a null byte");
  }
  for (const root of allowedRoots) {
    const realRoot = await fs.realpath(path.resolve(root)).catch(() => null);
    if (realRoot === null) continue;
    const candidate = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(realRoot, requested);
    if (!isInside(realRoot, candidate)) continue;
    // Resolve symlinks on the deepest existing ancestor so a link cannot point outside the root.
    const real = await realpathDeep(candidate);
    if (isInside(realRoot, real)) return real;
  }
  throw new PathDeniedError(`path is outside the allowed directories: ${requested}`);
}

async function realpathDeep(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    const parent = path.dirname(candidate);
    if (parent === candidate) return candidate;
    const realParent = await realpathDeep(parent);
    return path.join(realParent, path.basename(candidate));
  }
}

/** Read a file that was already resolved with `resolveInside`, enforcing a size cap. */
export async function readBounded(resolvedPath: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) throw new PathDeniedError("not a regular file");
  if (stat.size > maxBytes) throw new PathDeniedError(`file is larger than ${maxBytes} bytes`);
  return fs.readFile(resolvedPath, "utf8");
}
