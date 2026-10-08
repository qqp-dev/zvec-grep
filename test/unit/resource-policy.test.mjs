import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArgs } from "../../dist/cli/args.js";
import {
  configuredWatchLimits,
  configuredBackgroundDevice,
} from "../../dist/daemon/config.js";
import {
  assertExactIndexRoot,
  assertSearchWorkspaceRoot,
  RuntimeManager,
} from "../../dist/daemon/runtime-manager.js";

test("directory watch configuration keeps finite defaults and rejects unbounded values", () => {
  assert.equal(configuredBackgroundDevice({}), undefined);
  assert.equal(
    configuredBackgroundDevice({ ZVEC_GREP_BACKGROUND_DEVICE: "cpu" }),
    "cpu",
  );
  assert.throws(
    () => configuredBackgroundDevice({ ZVEC_GREP_BACKGROUND_DEVICE: "vulkan" }),
    { code: "INVALID_BACKGROUND_DEVICE" },
  );
  assert.deepEqual(configuredWatchLimits({}), {
    maxDirectoryWatchers: 2048,
    maxDaemonWatchers: 8192,
  });
  assert.deepEqual(
    configuredWatchLimits({
      ZVEC_GREP_MAX_ROOT_WATCHERS: "12",
      ZVEC_GREP_MAX_DAEMON_WATCHERS: "24",
    }),
    { maxDirectoryWatchers: 12, maxDaemonWatchers: 24 },
  );
  for (const raw of ["0", "-1", "1.5", "20001", "Infinity"]) {
    assert.throws(
      () => configuredWatchLimits({ ZVEC_GREP_MAX_DAEMON_WATCHERS: raw }),
      { code: "INVALID_WATCH_LIMIT" },
    );
  }
});

test("explicit index and independent search roots cannot activate an ancestor", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zvec-grep-root-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documents = join(root, "documents");
  const project = join(root, "project");
  await mkdir(documents);
  await mkdir(join(project, "src"), { recursive: true });
  await writeFile(join(project, "package.json"), "{}\n");
  assertExactIndexRoot(root, root);
  assert.throws(() => assertExactIndexRoot(project, root), {
    code: "ROOT_INDEX_MISMATCH",
  });
  await assertSearchWorkspaceRoot(documents, root);
  await assert.rejects(assertSearchWorkspaceRoot(project, root), {
    code: "INDEX_MISSING",
  });
  await assert.rejects(assertSearchWorkspaceRoot(join(project, "src"), root), {
    code: "INDEX_MISSING",
  });
  // A cached alias may predate a new project boundary. Busy runtimes must
  // enforce the boundary before reusing that alias for another operation.
  const manager = new RuntimeManager({ modelPool: {} });
  manager.aliases.set(project, root);
  manager.aliases.set(documents, root);
  manager.runtimes.set(root, {
    snapshot: () => ({ writerPending: true }),
    close: async () => {},
  });
  t.after(() => manager.close());
  await assert.rejects(manager.activate(project), { code: "INDEX_MISSING" });
  await assert.rejects(manager.activateForIndex(documents), {
    code: "ROOT_INDEX_MISMATCH",
  });
});

test("transient runtime is an indexing option and cannot accompany deletion", () => {
  const parsed = parseArgs([
    "--index",
    "/tmp/workspace",
    "--mode",
    "server",
    "--device",
    "cpu",
    "--runtime-ephemeral",
    "--embedding-concurrency",
    "1",
  ]);
  assert.equal(parsed.options.runtimeEphemeral, true);
  assert.equal(parsed.options.embeddingConcurrency, 1);
  assert.equal(parsed.options.device, "cpu");
  assert.throws(
    () => parseArgs(["--runtime-ephemeral", "query"]),
    /only be used with zg index/,
  );
  assert.throws(
    () => parseArgs(["--index", "--drop", "--runtime-ephemeral"]),
    /cannot be combined/,
  );
});
