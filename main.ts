// Palmira Heat — hand-in program for the make.fun gta6-01 bounty (Node 22, stdlib only).
//
// The entry itself is the static game in game/ (open game/index.html in a desktop browser and
// play; it loads nothing from the network). This program only packages it: it copies game/ and
// screenshots/ into the output directory and writes dossier.json there with the vendored
// make.fun library, exactly as the gate expects. The caps below are the scorer's own
// (reference/gate.json): they keep the package inside the limits the gate enforces, so an
// oversize entry fails here first instead of at grading.
//
// Run it the way the grader does, with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const entryDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy one directory tree of the entry into the output, creating the target first.
function copyTree(name: string): void {
  const from = join(entryDir, name);
  if (!existsSync(from)) return;
  const to = join(outputDir, name);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

mkdirSync(outputDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
