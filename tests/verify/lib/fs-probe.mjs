/**
 * Small filesystem helpers for cases that need a real SKILL.md on disk.
 * Kept separate so the md5/mtime reverse proof is easy to audit.
 */
import { mkdirSync, writeFileSync, rmSync, statSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Create a throwaway skill tree and return its paths. */
export function writeTempSkillTree(skills) {
  const root = join(tmpdir(), `qa-verify-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(root, { recursive: true })
  const files = {}
  for (const skill of skills) {
    const dir = join(root, skill.category ?? 'cat', skill.name)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'SKILL.md')
    writeFileSync(file, skillMarkdown(skill.name, skill.body ?? `Body of ${skill.name}.`))
    files[skill.name] = file
  }
  return { root, files }
}

/** Remove a throwaway tree. */
export function removeTree(root) {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {}
}

/** Record identity of one file: content hash, mtime, size, existence. */
export function hashFile(path) {
  if (!existsSync(path)) return { path, exists: false, md5: null, mtimeMs: null, size: null }
  const info = statSync(path)
  return {
    path,
    exists: true,
    md5: createHash('md5').update(readFileSync(path)).digest('hex'),
    mtimeMs: info.mtimeMs,
    size: info.size,
  }
}

/** One SKILL.md body with valid frontmatter. */
export function skillMarkdown(name, body) {
  return `---\nname: ${name}\ndescription: "Description for ${name}."\n---\n\n${body}\n`
}
