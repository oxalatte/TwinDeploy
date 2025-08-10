import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '.data');
const TARGETS = path.join(DATA_DIR, 'targets.json');
const MANIFESTS = path.join(DATA_DIR, 'manifests.json');

async function ensure() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const f of [TARGETS, MANIFESTS]) {
    try { await fs.access(f); } catch { await fs.writeFile(f, f===TARGETS?'[]':'[]'); }
  }
}

export async function getTargets() { await ensure(); return JSON.parse(await fs.readFile(TARGETS, 'utf8')); }
export async function saveTargets(list) { await ensure(); await fs.writeFile(TARGETS, JSON.stringify(list, null, 2)); }
export async function getManifests() { await ensure(); return JSON.parse(await fs.readFile(MANIFESTS, 'utf8')); }
export async function addManifest(m) { const all = await getManifests(); all.unshift(m); await fs.writeFile(MANIFESTS, JSON.stringify(all, null, 2)); return m; }
