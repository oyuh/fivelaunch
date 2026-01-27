#!/usr/bin/env node

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const readline = require('readline/promises')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const run = (cmd, opts = {}) => {
  const stdio = opts.stdio || 'pipe'
  return execSync(cmd, { stdio, encoding: 'utf8' }).toString().trim()
}

const logStep = (label) => {
  console.log(`\n=== ${label} ===`)
}

const ask = async (q, { defaultValue } = {}) => {
  const suffix = defaultValue != null && String(defaultValue).length ? ` [${defaultValue}]` : ''
  const ans = (await rl.question(`${q}${suffix}: `)).trim()
  return ans.length ? ans : defaultValue
}

const confirm = async (q, { defaultYes = false } = {}) => {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const ans = (await ask(`${q} (${hint})`, { defaultValue: '' })).toLowerCase()
  if (!ans) return defaultYes
  return ans === 'y' || ans === 'yes'
}

const normalizeVersion = (v) => String(v || '').trim().replace(/^v/i, '')

const parseSemver = (v) => {
  const cleaned = normalizeVersion(v)
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const prerelease = match[4] ? String(match[4]) : null
  if ([major, minor, patch].some((n) => Number.isNaN(n))) return null
  return { major, minor, patch, prerelease }
}

const bump = (v, kind) => {
  const p = parseSemver(v)
  if (!p) return null
  if (kind === 'major') return `${p.major + 1}.0.0`
  if (kind === 'minor') return `${p.major}.${p.minor + 1}.0`
  return `${p.major}.${p.minor}.${p.patch + 1}`
}

const readPkg = () => {
  const pkgPath = path.join(process.cwd(), 'package.json')
  const raw = fs.readFileSync(pkgPath, 'utf8')
  const json = JSON.parse(raw)
  return { pkgPath, raw, json }
}

const writePkgVersion = (pkgPath, raw, json, version) => {
  const next = { ...json, version }
  const updated = JSON.stringify(next, null, 2) + (raw.endsWith('\n') ? '\n' : '')
  fs.writeFileSync(pkgPath, updated)
}

const main = async () => {
  try {
    logStep('FiveLaunch Release CLI')

    try {
      run('git --version')
      const inside = run('git rev-parse --is-inside-work-tree')
      if (inside !== 'true') throw new Error('not a git repo')
    } catch {
      console.error('This script must be run inside a git repository with git installed.')
      process.exit(1)
    }

    const branch = run('git rev-parse --abbrev-ref HEAD')
    const statusShort = run('git status --porcelain')

    const { pkgPath, raw, json: pkg } = readPkg()
    const currentPkgVersion = normalizeVersion(pkg.version)

    let latestTag = ''
    try {
      latestTag = run('git fetch --tags --quiet && git tag --sort=-creatordate | head -n 1')
    } catch {
      // ignore
    }

    console.log(`Branch: ${branch}`)
    console.log(`package.json version: ${currentPkgVersion || '(missing)'}`)
    console.log(`Latest tag: ${latestTag || '(none found)'}`)
    console.log(`Working tree: ${statusShort ? 'DIRTY' : 'clean'}`)

    if (statusShort) {
      const ok = await confirm('Working tree has uncommitted changes. Continue (will stage everything)?', {
        defaultYes: true
      })
      if (!ok) return
    }

    // Suggest a version based on package.json.
    const suggestedPatch = bump(currentPkgVersion, 'patch')
    const suggestedMinor = bump(currentPkgVersion, 'minor')
    const suggestedMajor = bump(currentPkgVersion, 'major')

    console.log('\nPick version:')
    if (suggestedPatch) console.log(`  1) patch  -> ${suggestedPatch}`)
    if (suggestedMinor) console.log(`  2) minor  -> ${suggestedMinor}`)
    if (suggestedMajor) console.log(`  3) major  -> ${suggestedMajor}`)
    console.log('  4) custom -> type your own')

    const choice = await ask('Select 1-4', { defaultValue: '1' })

    let version = null
    if (choice === '2') version = suggestedMinor
    else if (choice === '3') version = suggestedMajor
    else if (choice === '4') {
      version = await ask('Enter version (MAJOR.MINOR.PATCH)', { defaultValue: suggestedPatch })
    } else {
      version = suggestedPatch
    }

    version = normalizeVersion(version)
    if (!parseSemver(version)) {
      console.error(`Invalid version: ${version}. Expected MAJOR.MINOR.PATCH (e.g., 0.1.4).`)
      process.exit(1)
    }

    const tag = `v${version}`
    const tagDesc = await ask('Optional tag descriptor (e.g. hotfix, leave empty)', {
      defaultValue: ''
    })
    const tagMessage = tagDesc ? `${tag} - ${tagDesc}` : tag

    // Version bump
    if (currentPkgVersion !== version) {
      const bumpPkg = await confirm(`Update package.json version to ${version}?`, { defaultYes: true })
      if (bumpPkg) {
        logStep('Updating package.json')
        writePkgVersion(pkgPath, raw, pkg, version)
        console.log(`Updated ${path.relative(process.cwd(), pkgPath)} -> version ${version}`)
      }
    }

    const runChecks = await confirm('Run pnpm typecheck before committing?', { defaultYes: true })
    if (runChecks) {
      logStep('Running pnpm typecheck')
      execSync('pnpm -s typecheck', { stdio: 'inherit' })
    }

    // Stage
    const stageAll = await confirm('Stage all changes (git add -A)?', { defaultYes: true })
    if (!stageAll) {
      console.log('Aborted: nothing staged.')
      return
    }

    logStep('Staging changes')
    execSync('git add -A', { stdio: 'inherit' })

    const cached = run('git diff --cached --stat')
    if (!cached) {
      console.log('No staged changes. Nothing to release.')
      return
    }

    console.log('\nStaged changes:\n' + cached)

    const commitDefault = `Release ${tag}`
    const commitMessage = await ask('Commit message', { defaultValue: commitDefault })

    const doCommit = await confirm(`Create commit now?`, { defaultYes: true })
    if (!doCommit) return

    logStep('Creating commit')
    try {
      execSync(`git commit -m "${String(commitMessage).replace(/\"/g, '\\"')}"`, {
        stdio: 'inherit'
      })
    } catch {
      console.error('git commit failed. (Maybe nothing changed, or hooks failed.)')
      process.exit(1)
    }

    const createTag = await confirm(`Create annotated tag ${tag}?`, { defaultYes: true })
    if (!createTag) return

    logStep('Creating tag')
    try {
      execSync(`git tag -a ${tag} -m "${String(tagMessage).replace(/\"/g, '\\"')}"`, {
        stdio: 'inherit'
      })
    } catch {
      console.error('Failed to create tag. It may already exist.')
      process.exit(1)
    }

    const push = await confirm('Push commit + tag to origin (git push origin HEAD --follow-tags)?', {
      defaultYes: true
    })
    if (push) {
      logStep('Pushing to origin')
      execSync('git push origin HEAD --follow-tags', { stdio: 'inherit' })
    } else {
      console.log('Skipped push. To push later:')
      console.log(`  git push origin HEAD --follow-tags`)
    }

    logStep('Done')
    console.log(`Released ${tag}. GitHub Actions should create the release after the tag is pushed.`)
  } finally {
    rl.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
