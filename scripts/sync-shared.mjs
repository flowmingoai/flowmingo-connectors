// Copies shared/contract.json into every connector that bundles it. Each marketplace builds from its own folder only,
// so the connectors cannot reach ../shared at runtime; a test in each one fails when its copy drifts from the source.
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'shared', 'contract.json')
const targets = ['zapier/lib/contract.json', 'n8n/nodes/Flowmingo/contract.json']

for (const target of targets) {
  copyFileSync(source, join(root, target))
  console.log(`copied shared/contract.json -> ${target}`)
}
