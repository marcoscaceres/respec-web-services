// Spawned by lib/scraper.ts as its own process, because the transform it runs
// peaks near 560 MB and a worker thread would charge that to the server.
//
// Runnable by hand to rebuild the data file without restarting the server:
//   node build/routes/bibrefs/lib/build-data.js <cloneDirectory> <outputFile>

import { createRequire } from "node:module";
import {
  copyFileSync,
  lstatSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { PROJECT_ROOT } from "../../../utils/constants.js";
import { validate } from "./validate.js";

const VENDOR_DIRECTORY = path.join(PROJECT_ROOT, "vendor", "specref");
const TRANSFORM = "bibref.js";
const VENDORED_FILES = [TRANSFORM, "format-date.js"];

/** Symlinks survive a clone, and the transform reads every file in here. */
function assertEveryInputIsAPlainJsonFile(directory: string) {
  const rejected = readdirSync(directory).filter(
    name =>
      !name.endsWith(".json") ||
      !lstatSync(path.join(directory, name)).isFile(),
  );
  if (rejected.length) {
    throw new Error(
      `Refusing to build, these are not plain .json files: ${rejected.join(", ")}`,
    );
  }
}

/** The transform finds its input at `__dirname/../refs`, so it has to run inside the clone. */
function copyVendoredTransform(cloneDirectory: string) {
  for (const name of VENDORED_FILES) {
    copyFileSync(
      path.join(VENDOR_DIRECTORY, name),
      path.join(cloneDirectory, "lib", name),
    );
  }
  return path.join(cloneDirectory, "lib", TRANSFORM);
}

function build(cloneDirectory: string, outputFile: string) {
  assertEveryInputIsAPlainJsonFile(path.join(cloneDirectory, "refs"));
  const bibref = createRequire(import.meta.url)(
    copyVendoredTransform(cloneDirectory),
  );
  const references = bibref.all;

  // The transform keeps its merged input and a reverse-lookup index alive next
  // to the result. Nothing here reads either, and together they are most of the
  // peak this process is capped at.
  bibref.raw = null;
  bibref.reverseLookupTable = null;

  const problem = validate(references);
  if (problem) throw new Error(`Refusing to publish: ${problem}.`);

  // Rename, so a crash mid-write cannot leave a truncated file to load at boot.
  const temporary = `${outputFile}.incoming`;
  writeFileSync(temporary, JSON.stringify(references), "utf8");
  renameSync(temporary, outputFile);
  return Object.keys(references).length;
}

const [cloneDirectory, outputFile] = process.argv.slice(2);
if (!cloneDirectory || !outputFile) {
  console.error("usage: build-data.js <cloneDirectory> <outputFile>");
  process.exit(1);
}
const count = build(cloneDirectory, outputFile);
const peakMegabytes = Math.round(process.memoryUsage().rss / 1024 / 1024);
console.log(
  `Wrote ${count} references to ${outputFile} (peak ${peakMegabytes} MB)`,
);
