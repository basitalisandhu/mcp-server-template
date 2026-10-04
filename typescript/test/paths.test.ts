import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PathDeniedError, readBounded, resolveInside } from "../src/safety/paths.js";

let root: string;
let outside: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-paths-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-outside-"));
  await fs.mkdir(path.join(root, "sub"));
  await fs.writeFile(path.join(root, "sub", "a.txt"), "hello");
  await fs.writeFile(path.join(outside, "secret.txt"), "nope");
  await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "link-out"));
  await fs.symlink(path.join(outside), path.join(root, "dir-out"));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("refuses everything when no roots are configured", async () => {
    await expect(resolveInside([], "a.txt")).rejects.toBeInstanceOf(PathDeniedError);
  });

  it("accepts relative and absolute paths inside a root", async () => {
    const real = await fs.realpath(path.join(root, "sub", "a.txt"));
    expect(await resolveInside([root], "sub/a.txt")).toBe(real);
    expect(await resolveInside([root], path.join(root, "sub", "a.txt"))).toBe(real);
  });

  it("refuses traversal, absolute paths outside, null bytes and symlink escapes", async () => {
    await expect(resolveInside([root], "../etc/passwd")).rejects.toBeInstanceOf(PathDeniedError);
    await expect(resolveInside([root], "sub/../../" + path.basename(outside) + "/secret.txt")).rejects.toBeInstanceOf(PathDeniedError);
    await expect(resolveInside([root], path.join(outside, "secret.txt"))).rejects.toBeInstanceOf(PathDeniedError);
    await expect(resolveInside([root], "a\0.txt")).rejects.toBeInstanceOf(PathDeniedError);
    await expect(resolveInside([root], "link-out")).rejects.toBeInstanceOf(PathDeniedError);
    await expect(resolveInside([root], "dir-out/secret.txt")).rejects.toBeInstanceOf(PathDeniedError);
  });

  it("resolves a path that does not exist yet inside the root", async () => {
    const resolved = await resolveInside([root], "sub/new.txt");
    expect(resolved.startsWith(await fs.realpath(root))).toBe(true);
  });
});

describe("readBounded", () => {
  it("enforces the size cap and regular files", async () => {
    const file = await resolveInside([root], "sub/a.txt");
    expect(await readBounded(file, 100)).toBe("hello");
    await expect(readBounded(file, 2)).rejects.toThrow(/larger than/);
    await expect(readBounded(await resolveInside([root], "sub"), 100)).rejects.toThrow(/regular file/);
  });
});
