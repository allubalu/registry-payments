import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Mirrors packages/domain/tests/guards/source-scan.ts, but scans from the
 * workspace root so one guard can cover both the API and the client. Kept as a
 * copy rather than a shared import: a guard that depends on another package's
 * test helpers can be broken from outside the package it protects.
 */
const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url))

export interface SourceFile {
  /** Path relative to the workspace root, e.g. "packages/api/src/app.ts". */
  readonly path: string
  readonly text: string
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

/** Read every .ts/.tsx file beneath a directory relative to the workspace root. */
export function readSourceFiles(relativeDir: string): SourceFile[] {
  const absolute = join(workspaceRoot, relativeDir)
  const files: SourceFile[] = []

  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue

    const full = join(entry.parentPath, entry.name)
    files.push({
      path: relative(workspaceRoot, full).replaceAll('\\', '/'),
      text: readFileSync(full, 'utf8'),
    })
  }

  return files
}

/** Strip line and block comments so a guard never flags prose. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}
