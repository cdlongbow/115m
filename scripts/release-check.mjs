import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const root = process.cwd()

function step(message) {
  console.log(`[check] ${message}`)
}

function fail(message) {
  console.error(`[fail] ${message}`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))

if (pkg.version !== manifest.version) {
  fail(`版本不一致：package.json=${pkg.version}, manifest.json=${manifest.version}`)
}
step(`版本一致：${pkg.version}`)

const zipPath = resolve(root, 'release', `115m-v${pkg.version}.zip`)
if (!existsSync(zipPath)) {
  fail(`缺少发布包：release/115m-v${pkg.version}.zip，请先执行 pnpm zip`)
}
step(`发布包存在：release/115m-v${pkg.version}.zip`)

try {
  execSync('gh auth status', { cwd: root, stdio: 'pipe' })
  step('gh 已登录，可继续发布 GitHub Release')
}
catch {
  fail('gh 未登录或已失效，请先执行 gh auth login')
}

const projectLogPath = resolve(root, '项目日志.md')
if (!existsSync(projectLogPath)) {
  fail('缺少 项目日志.md')
}
const projectLog = readFileSync(projectLogPath, 'utf8')
if (!projectLog.includes(`## v${pkg.version}`)) {
  fail(`项目日志缺少版本段：## v${pkg.version}`)
}
step(`项目日志已记录 v${pkg.version}`)

const workflowPath = resolve(root, '.github/workflows/release-to-telegram.yml')
if (existsSync(workflowPath)) {
  step('已存在 Telegram 发布通知 workflow')
}

const releaseFiles = existsSync(resolve(root, 'release')) ? readdirSync(resolve(root, 'release')) : []
step(`release 目录文件数：${releaseFiles.length}`)
step('release check 通过')
