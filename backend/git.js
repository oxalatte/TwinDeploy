import simpleGit from 'simple-git';
import fs from 'fs/promises';

export async function getRepoRoot(repoPath) {
  const git = simpleGit(repoPath);
  return await git.revparse(['--show-toplevel']);
}

export async function listChanged(repoPath, baseRef = 'HEAD~1') {
  const git = simpleGit(repoPath);
  const root = await getRepoRoot(repoPath);
  const files = await git.diff([`${baseRef}...HEAD`, '--name-only', '--diff-filter=ACMRT']);
  return files.split('\n').filter(Boolean).map(p => ({ path: p }));
}

export async function listStaged(repoPath) {
  const git = simpleGit(repoPath);
  const root = await getRepoRoot(repoPath);
  const status = await git.status();
  // simple-git status fields:
  // status.staged: modified & staged
  // status.created: new files added
  // status.renamed: array of {from,to}
  // status.deleted: deleted but staged
  const collected = [
    ...status.staged,
    ...status.created,
    ...status.deleted,
    ...status.renamed.map(r=>r.to)
  ].filter(Boolean);
  const uniq = Array.from(new Set(collected));
  return uniq.map(p => ({ path: p }));
}

export async function fileStat(absPath) {
  try { return await fs.stat(absPath); } catch { return null; }
}
