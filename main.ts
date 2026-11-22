// Neon Harbor — the hand-in program for make.fun's gta6-01 bounty.
//
// What this does, in three moves:
//   1. Take the playable game (the game/ folder beside this file) and the
//      screenshots/ folder and stage both into the output directory.
//   2. Ask the vendored make.fun library to summarise that output as
//      dossier.json, the summary the judge reads.
//   3. Print what landed, so a local run shows the same shape the grader sees.
//
// The game itself is plain static files — game/index.html plus ES modules,
// no libraries, no network — so the output is just a copy, not a build.
// Run it outside the grader's container with an output directory of your own:
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts
//
// and serve the game while you work on it with `node serve.ts`.
import { buildDossier } from './vendor/makefun-game.ts';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The scorer's own limits, taken from the bounty's gate: the text cap shapes
// the dossier's bytes, the rest only refuse an entry the scorer would refuse
// (more than 4 screenshots, or one over 256 KiB; more than 993 files under
// game/, or 48 MiB of game files in all, or a game path over 1000 bytes —
// game/ counts beside the output's own 1000-entry cap, with screenshots/ and
// dossier.json). Passing them here makes this program fail exactly where the
// scorer would, instead of handing in something it will reject.
const SCORER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

/** Stop with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  console.error(`main.ts: ${message}`);
  process.exit(1);
}

/** The directory this file lives in, resolved so relative paths never depend on the caller's cwd. */
function entryDir(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)));
}

/** Where the staged entry goes: the grader's /output, or MAKEFUN_OUTPUT_DIR locally. */
function outputDir(): string {
  return process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
}

/** Count every file and directory under a path, the way the grader's 1000-entry cap counts them. */
function countEntries(path: string): number {
  let total = 1;
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    total += statSync(child).isDirectory() ? countEntries(child) : 1;
  }
  return total;
}

/** Copy a whole tree into the output, creating the destination first. */
function stage(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function main(): void {
  const here = entryDir();
  const out = outputDir();

  const gameDir = join(here, 'game');
  if (!existsSync(join(gameDir, 'index.html'))) {
    fail(`game/index.html is missing under ${gameDir} — nothing playable to hand in`);
  }

  mkdirSync(out, { recursive: true });
  stage(gameDir, join(out, 'game'));

  const shotsDir = join(here, 'screenshots');
  const shotsOut = join(out, 'screenshots');
  mkdirSync(shotsOut, { recursive: true });
  if (existsSync(shotsDir)) stage(shotsDir, shotsOut);

  const dossier = buildDossier(out, SCORER_CAPS);
  writeFileSync(join(out, 'dossier.json'), dossier);

  const staged = countEntries(join(out, 'game')) + countEntries(shotsOut);
  console.log(
    `Neon Harbor staged to ${out}: ${staged} entries under game/ + screenshots/, dossier.json ${dossier.length} bytes.`,
  );
}

main();
