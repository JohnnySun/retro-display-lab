// Generates retroarch-pack.json: the file list a frontend installer needs to deploy this
// project's KONKR presets into a RetroArch installation, and to tell an installed copy apart
// from a newer published one.
//
// The manifest is deliberately a static file with per-file SHA-256 rather than a repository
// archive: an installer fetches one small JSON, downloads only the files the presets actually
// reference, and can verify every byte it writes. It pins `ref` so the hashes and the downloads
// come from the same commit — resolving files against a moving branch would make every hash
// check fail the moment somebody pushes between the two requests.
//
//   node tools/build-retroarch-pack.mjs           # write
//   node tools/build-retroarch-pack.mjs --check   # fail if stale
//   node tools/build-retroarch-pack.mjs --ref v0.7.0
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "retroarch-pack.json");
const checkOnly = process.argv.includes("--check");
const refFlag = process.argv.indexOf("--ref");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// Every path is read out of `ref` rather than out of the working tree. An installer downloads
// these files from that ref, so hashing what happens to be checked out would publish hashes for
// bytes nobody can fetch — which is what a working-tree version of this generator did: it
// cheerfully described files at a tag that predated them, and `--check` stayed green while every
// install would have 404ed.
//
// --check re-derives the manifest from the ref the manifest itself names, so the invariant it
// enforces is "this document faithfully describes that ref". Writing a new one needs an explicit
// --ref, defaulting to the tag matching package.json.
const existing = fs.existsSync(output)
  ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
const ref = refFlag !== -1 ? process.argv[refFlag + 1]
  : checkOnly && existing ? existing.ref : `v${pkg.version}`;

function resolveRef() {
  try {
    return execFileSync("git", ["rev-parse", "-q", "--verify", `${ref}^{commit}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error(
      `${ref} does not resolve to a commit. Tag the release before publishing the manifest, `
      + "or pass --ref with a commit that is pushed.");
  }
}
const commit = resolveRef();

/** File contents at `ref`, or null when the ref does not carry that path. */
function readAtRef(relative) {
  try {
    // stderr is silenced: a missing path is an expected answer here, not noise to print.
    return execFileSync("git", ["show", `${commit}:${relative}`],
      { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const target = "targets/konkr-gt78-vn/960x640-srgb-neutral";

// One entry per preset a frontend can select. `route` is the mutual-exclusion group member it
// belongs to: an installer must never deploy a retroarch-local preset while the Android-system
// host correction is active, and vice versa.
const presets = [
  // one-year-used, not reference: reference runs CurrentDriveCoherence at 0, the pure physical
  // path, which leaves moving solids incomplete. It is the diagnostic preset. The project's own
  // hand-deploy override in integrations/ has always named one-year-used as the default, and an
  // installer that disagrees with it is the installer that is wrong.
  { core: "Gambatte", content: "gb", route: "android-system",
    preset: `${target}/presets/dmg01-one-year-used-v1.slangp` },
  { core: "Gambatte", content: "gb", route: "retroarch-local",
    preset: `${target}/presets/dmg01-one-year-used-kpa-color-corrected.slangp` },
  { core: "mGBA", content: "gba", route: "android-system",
    preset: `${target}/presets/ags101-period-reconstruction-v1.slangp` },
  { core: "mGBA", content: "gba", route: "retroarch-local",
    preset: `${target}/presets/ags101-period-reconstruction-kpa-color-corrected.slangp` },
];

// Alternative presets a user may select by hand. They are shipped so the selection exists, but
// no override points at them.
const extraPresets = [
  `${target}/presets/dmg01-reference-v1.slangp`,
  `${target}/presets/dmg01-reference-kpa-color-corrected.slangp`,
  `${target}/presets/dmg01-lightly-used-v1.slangp`,
];

// Core/content settings the temporal presets depend on. Not installed automatically — they
// change emulator behaviour — but shipped so the documented values travel with the presets.
const settings = [
  `${target}/retroarch/dmg01-temporal.cfg`,
  `${target}/retroarch/ags101-temporal.cfg`,
];

/** Every .slang / .png / .slangp a preset reaches, resolved relative to the preset itself. */
function closure(entry, seen = new Set()) {
  const normalised = path.normalize(entry);
  if (seen.has(normalised)) return seen;
  if (normalised.startsWith("..")) throw new Error(`${normalised}: escapes the repository`);
  const content = readAtRef(normalised);
  if (content === null) {
    throw new Error(`${normalised}: not present at ${ref}. `
      + "The manifest can only describe files that ref actually carries.");
  }
  seen.add(normalised);
  if (!normalised.endsWith(".slangp")) return seen;
  const directory = path.dirname(normalised);
  for (const line of content.toString("utf8").split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const reference = line.match(/^\s*\w+\s*=\s*"([^"]+)"/);
    if (!reference) continue;
    const value = reference[1];
    if (!/\.(slang|slangp|png)$/.test(value)) continue;
    closure(path.join(directory, value), seen);
  }
  return seen;
}

const paths = new Set();
for (const entry of [...presets.map((p) => p.preset), ...extraPresets]) {
  for (const file of closure(entry)) paths.add(file);
}
for (const file of settings) {
  if (readAtRef(file) === null) throw new Error(`${file}: not present at ${ref}`);
  paths.add(file);
}

const files = [...paths].sort().map((file) => {
  const bytes = readAtRef(file);
  return {
    path: file,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
});

const manifest = {
  schemaVersion: 1,
  packVersion: pkg.version,
  ref,
  // Where an installer places the files, relative to RetroArch's shader directory. The presets
  // reference each other by relative path, so the tree below this root must be preserved exactly.
  installRoot: "retro-display-lab",
  target: {
    id: JSON.parse(readAtRef(`${target}/profile.json`).toString("utf8")).id,
    profile: `${target}/profile.json`,
  },
  // An installer writes one override per core/content pair, choosing the entry whose route
  // matches the host correction currently in use. Deploying both routes at once is the
  // double-calibration failure the target profile warns about.
  overrides: presets.map((preset) => ({
    core: preset.core,
    content: preset.content,
    route: preset.route,
    // RetroArch reads config/<core>/<content>.slangp as a content-directory override.
    configPath: `${preset.core}/${preset.content}.slangp`,
    preset: preset.preset,
  })),
  settings,
  files,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
};

const expected = `${JSON.stringify(manifest, null, 2)}\n`;
if (checkOnly) {
  if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== expected) {
    throw new Error("retroarch-pack.json is stale; run tools/build-retroarch-pack.mjs");
  }
} else {
  fs.writeFileSync(output, expected);
}

console.log(`retroarch-pack.json is ${checkOnly ? "current" : "generated"}: `
  + `${files.length} files, ${(manifest.totalBytes / 1024).toFixed(0)} KB, `
  + `ref ${ref} (${commit.slice(0, 12)}).`);
