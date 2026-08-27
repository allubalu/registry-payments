import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

export interface SourceFile {
  /** Path relative to the package root, e.g. "src/fees/compute.ts". */
  readonly path: string
  readonly text: string
}

/** Read every .ts file beneath a directory relative to the package root. */
export function readSourceFiles(relativeDir: string): SourceFile[] {
  const absolute = join(packageRoot, relativeDir)
  const files: SourceFile[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    const full = join(entry.parentPath, entry.name)
    files.push({
      path: relative(packageRoot, full).replaceAll('\\', '/'),
      text: readFileSync(full, 'utf8'),
    })
  }
  return files
}

/** Strip line and block comments so a guard never flags prose. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}
