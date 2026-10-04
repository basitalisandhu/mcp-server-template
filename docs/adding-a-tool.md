# Adding a tool

The four bundled tools are read-only on purpose. When a project needs a tool that writes or acts, add it with the same shape and decide what it must refuse before writing what it does.

## Checklist

1. **Description as a literal.** Write the description in the source as a fixed string. Never build it from configuration, files or network data: the model reads it, so a description that can change at runtime is an injection channel.
2. **Strict schema.** Bound every string (`max`/`max_length`), use enums for choices, reject unknown properties (zod `.strict()` or pydantic `extra="forbid"`), and describe each field for the model.
3. **Annotations that tell the truth.** `readOnlyHint: false` and `destructiveHint: true` for anything that writes, deletes or sends. Clients use these to decide when to ask the user.
4. **Bounded effect.** Resolve paths with `resolveInside` / `safe_join`; validate URLs with `assertSafeUrl` / `validate_url`; cap sizes and time; never pass a model-chosen string to a shell. If the tool needs a credential, read it from the environment inside the server and never accept it as an argument.
5. **Approval outside the model.** For high-impact actions (payments, deletions, messages to third parties), require an approval that the model cannot grant itself: a credential broker, a policy layer, or a client-side confirmation.
6. **Log the decision, not the secret.** Log the resolved target and the outcome through the provided logger; it redacts, but do not rely on it for values you know are secrets.
7. **Tests for the refusals.** Every tool test covers the allowed case and at least one refused case (outside the root, host not on the allowlist, oversize input).
8. **Semgrep stays clean.** Run the rule pack. A finding on a new tool is a design review, not a false positive to suppress.

## Example: a write tool (TypeScript)

```ts
server.registerTool(
  "write_note",
  {
    title: "Write note",
    description: "Write a UTF-8 text file inside the notes directory this server was configured to expose. Overwrites an existing note with the same name.",
    inputSchema: {
      name: z.string().regex(/^[a-z0-9-]{1,64}$/).describe("Note name, lowercase letters, digits and dashes"),
      content: z.string().max(100_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ name, content }) => {
    const target = await resolveInside(settings.allowedDirs, `${name}.md`);
    await fs.writeFile(target, content, "utf8");
    log.info("write_note", { path: target, bytes: Buffer.byteLength(content) });
    return { content: [{ type: "text", text: `wrote ${target}` }] };
  },
);
```

The name pattern keeps the model from choosing the path; `resolveInside` keeps the result inside the allowed directory even so.
