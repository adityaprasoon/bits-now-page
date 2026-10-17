import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSite } from "./build.mjs";

test("Pages output fingerprints every local asset and preserves page behavior", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "now-page-build-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL("../", import.meta.url));
  const files = ["index.html", "admin.html", "styles.css", "supabase-config.js", "app.js", "admin.js"];
  for (const filename of files) {
    await copyFile(path.join(source, filename), path.join(root, filename));
  }

  const output = path.join(root, "dist");
  const first = await buildSite(root);
  assert.equal(first.size, 4);
  assert.deepEqual((await readdir(output)).sort(), [".nojekyll", "admin.html", "assets", "index.html"]);
  for (const [original, fingerprinted] of first) {
    const content = await readFile(path.join(root, original));
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    assert.ok(fingerprinted.includes(`.${hash}.`));
    assert.deepEqual(await readFile(path.join(output, fingerprinted)), content);
  }

  for (const page of ["index.html", "admin.html"]) {
    const original = await readFile(path.join(root, page), "utf8");
    const built = await readFile(path.join(output, page), "utf8");
    let restored = built;
    for (const [filename, fingerprinted] of first) {
      restored = restored.replaceAll(fingerprinted, filename);
    }
    assert.equal(restored, original);
    for (const match of built.matchAll(/(?:src|href)="([^\"]+)"/g)) {
      const url = match[1];
      if (/^(?:https?:|data:|#)/.test(url)) continue;
      await readFile(path.join(output, url));
      if (/\.(css|js)$/.test(url)) assert.ok([...first.values()].includes(url));
    }
  }

  assert.deepEqual(await buildSite(root), first);
  await writeFile(path.join(root, "styles.css"), "body { color: red; }\n");
  const changed = await buildSite(root);
  assert.notEqual(changed.get("styles.css"), first.get("styles.css"));
  assert.equal(changed.get("app.js"), first.get("app.js"));
  assert.ok((await readFile(path.join(output, "index.html"), "utf8")).includes(changed.get("styles.css")));
  await assert.rejects(readFile(path.join(output, first.get("styles.css"))), { code: "ENOENT" });
});