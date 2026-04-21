import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const root = process.cwd()

function ok(message) {
  console.log(`[ok] ${message}`)
}

function warn(message) {
  console.log(`[warn] ${message}`)
}

function fail(message) {
  console.error(`[fail] ${message}`)
  process.exitCode = 1
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const packagePath = resolve(root, 'package.json')
const manifestPath = resolve(root, 'manifest.json')
const releaseRunbookPath = resolve(root, 'docs/runbooks/release.md')
const imageWallRunbookPath = resolve(root, 'docs/runbooks/image-wall.md')
const telegramWorkflowPath = resolve(root, '.github/workflows/release-to-telegram.yml')

if (!existsSync(packagePath)) fail('缺少 package.json')
if (!existsSync(manifestPath)) fail('缺少 manifest.json')

const pkg = readJson(packagePath)
const manifest = readJson(manifestPath)

if (pkg.version === manifest.version) ok(`package.json 与 manifest.json 版本一致：${pkg.version}`)
else fail(`版本不一致：package.json=${pkg.version}, manifest.json=${manifest.version}`)

if (existsSync(releaseRunbookPath)) ok('已存在 release runbook')
else warn('缺少 docs/runbooks/release.md')

if (existsSync(imageWallRunbookPath)) ok('已存在 image-wall runbook')
else warn('缺少 docs/runbooks/image-wall.md')

if (existsSync(telegramWorkflowPath)) ok('已存在 Telegram Release workflow')
else warn('缺少 .github/workflows/release-to-telegram.yml')

try {
  const branch = execSync('git branch --show-current', { cwd: root, encoding: 'utf8' }).trim()
  ok(`当前分支：${branch}`)
}
catch {
  warn('当前目录不是可用的 git 环境，或 git 不可用')
}

try {
  const pnpmVersion = execSync('pnpm --version', { cwd: root, encoding: 'utf8' }).trim()
  ok(`pnpm 可用：${pnpmVersion}`)
}
catch {
  fail('pnpm 不可用')
}

try {
  const ghStatus = execSync('gh auth status', { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  ok('gh 已登录')
  if (ghStatus.includes('Active account')) ok('gh 当前账户可用')
}
catch {
  warn('gh 未登录或登录失效，发布 GitHub Release 前需重新认证')
}

const releaseDir = resolve(root, 'release')
if (existsSync(releaseDir)) ok('存在 release 目录')
else warn('release 目录不存在，执行 pnpm zip 后会自动创建')
