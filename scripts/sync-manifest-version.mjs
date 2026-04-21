import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const packagePath = resolve(root, 'package.json')
const manifestPath = resolve(root, 'manifest.json')

const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

if (!pkg.version) {
  throw new Error('package.json version is missing')
}

if (manifest.version !== pkg.version) {
  manifest.version = pkg.version
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`[115m] synced manifest version -> ${pkg.version}`)
}
else {
  console.log(`[115m] manifest version already ${pkg.version}`)
}
