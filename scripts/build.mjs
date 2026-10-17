import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function buildSite(root, output = path.join(root, "dist")) {
  const entries = await readdir(root, { withFileTypes: true });
  const assets = entries.filter((entry) => entry.isFile() && /\.(css|js)$/.test(entry.name));
  const pages = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".html"));
  const assetNames = new Map();

  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, "assets"), { recursive: true });

  for (const asset of assets) {
    const content = await readFile(path.join(root, asset.name));
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const extension = path.extname(asset.name);
    const filename = `${path.basename(asset.name, extension)}.${hash}${extension}`;
    const url = `assets/${filename}`;
    assetNames.set(asset.name, url);
    await writeFile(path.join(output, url), content);
  }

  for (const page of pages) {
    let html = await readFile(path.join(root, page.name), "utf8");
    for (const [original, fingerprinted] of assetNames) {
      for (const quote of ['"', "'"]) {
        html = html.replaceAll(`${quote}${original}${quote}`, `${quote}${fingerprinted}${quote}`);
      }
    }
    await writeFile(path.join(output, page.name), html);
  }

  await writeFile(path.join(output, ".nojekyll"), "");
  return assetNames;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const assets = await buildSite(root);
  console.log(`Built ${assets.size} fingerprinted assets in dist/`);
}