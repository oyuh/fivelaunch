#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const readline = require('readline/promises')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const run = (file, args = [], opts = {}) => {
  const res = spawnSync(file, args, {
    stdio: opts.stdio || 'pipe',
    encoding: 'utf8',
    shell: false
  })

  if (res.error) throw res.error
  if (typeof res.status === 'number' && res.status !== 0) {
    const msg = (res.stderr || res.stdout || '').toString().trim()
    throw new Error(msg || `${file} exited with code ${res.status}`)
  }

  return (res.stdout || '').toString().trim()
}

const runInherit = (file, args = []) => {
  const res = spawnSync(file, args, { stdio: 'inherit', shell: false })
  if (res.error) throw res.error
  if (typeof res.status === 'number' && res.status !== 0) {
    throw new Error(`${file} exited with code ${res.status}`)
  }
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
  while (true) {
    const ans = (await ask(`${q} (${hint})`, { defaultValue: '' })).toLowerCase()
    if (!ans) return defaultYes
    if (ans === 'y' || ans === 'yes') return true
    if (ans === 'n' || ans === 'no') return false
    console.log('Please answer y or n.')
  }
}

const stripWrappingQuotes = (s) => {
  const t = String(s || '').trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim()
  }
  return t
}

const getArgValue = (names) => {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    for (const name of names) {
      if (arg === name) {
        const next = argv[i + 1]
        return next && !next.startsWith('-') ? next : ''
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1)
      }
    }
  }
  return ''
}

const readMessageFromFile = (filePath) => {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)
  const raw = fs.readFileSync(fullPath, 'utf8')
  const text = raw.replace(/^\uFEFF/, '').trimEnd()
  return { fullPath, message: text }
}

const readMultilineMessage = async (introPrompt) => {
  console.log(introPrompt)
  console.log('Enter your message. Finish by typing a line with just: """')
  const lines = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = await rl.question('> ')
    if (line.trim() === '"""') break
    lines.push(line)
  }
  return lines.join('\n').trimEnd()
}

const interpretBackslashEscapes = (s) => {
  const text = String(s || '')
  // Convenience for terminals where entering multi-line is annoying:
  // allow users to type \n and \n\n to create newlines/paragraphs.
  return text.replace(/\\n/g, '\n')
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
      run('git', ['--version'])
      const inside = run('git', ['rev-parse', '--is-inside-work-tree'])
      if (inside !== 'true') throw new Error('not a git repo')
    } catch {
      console.error('This script must be run inside a git repository with git installed.')
      process.exit(1)
    }

    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    const statusShort = run('git', ['status', '--porcelain'])

    const { pkgPath, raw, json: pkg } = readPkg()
    const currentPkgVersion = normalizeVersion(pkg.version)

    let latestTag = ''
    try {
      // Keep this robust across shells/OS: do it in two calls.
      run('git', ['fetch', '--tags', '--quiet'])
      latestTag = run('git', ['tag', '--sort=-creatordate']).split(/\r?\n/).filter(Boolean)[0] || ''
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

    const choice = await ask('Select 1-4 (or type a version like 0.1.11)', { defaultValue: '1' })

    let version = null
    if (parseSemver(choice)) {
      version = normalizeVersion(choice)
    } else if (choice === '2') version = suggestedMinor
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
    const tagDesc = stripWrappingQuotes(
      await ask('Optional tag descriptor (e.g. hotfix, leave empty)', {
      defaultValue: ''
      })
    )
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
      runInherit('pnpm', ['-s', 'typecheck'])
    }

    // Stage
    const stageAll = await confirm('Stage all changes (git add -A)?', { defaultYes: true })
    if (!stageAll) {
      console.log('Aborted: nothing staged.')
      return
    }

    logStep('Staging changes')
    runInherit('git', ['add', '-A'])

    const cached = run('git', ['diff', '--cached', '--stat'])
    if (!cached) {
      console.log('No staged changes. Nothing to release.')
      return
    }

    console.log('\nStaged changes:\n' + cached)

    const commitDefault = `Release ${tag}`
    const messageFileArg = stripWrappingQuotes(getArgValue(['--message-file', '--messageFile', '--msg-file', '-F', '--file']))
    const defaultReleaseTxt = path.join(process.cwd(), 'release.txt')

    let commitMessage = ''
    let commitMessageSource = ''
    try {
      if (messageFileArg) {
        const { fullPath, message } = readMessageFromFile(messageFileArg)
        if (message.trim()) {
          commitMessage = message
          commitMessageSource = fullPath
        }
      } else if (fs.existsSync(defaultReleaseTxt)) {
        const { fullPath, message } = readMessageFromFile(defaultReleaseTxt)
        if (message.trim()) {
          commitMessage = message
          commitMessageSource = fullPath
        }
      }
    } catch {
      // ignore
    }

    if (commitMessageSource) {
      console.log(`\nUsing commit message from file: ${path.relative(process.cwd(), commitMessageSource)}`)
    } else {
      commitMessage = stripWrappingQuotes(
        await ask('Commit message (Enter for default; type """ for multi-line; you can also use \\n)', {
          defaultValue: commitDefault
        })
      )

      if (commitMessage === '"""') {
        commitMessage = await readMultilineMessage(
          'Multi-line commit message mode\nTip: first line = subject, blank line, then body.'
        )
        if (!commitMessage.trim()) {
          console.log('Empty commit message. Aborted.')
          return
        }
      } else {
        commitMessage = interpretBackslashEscapes(commitMessage)
      }
    }

    if (!commitMessage.trim()) {
      commitMessage = commitDefault
    }

    const doCommit = await confirm(`Create commit now?`, { defaultYes: true })
    if (!doCommit) return

    logStep('Creating commit')
    const msgFile = path.join(os.tmpdir(), `fivelaunch-release-message-${Date.now()}.txt`)
    try {
      fs.writeFileSync(msgFile, `${commitMessage}\n`, 'utf8')
      runInherit('git', ['commit', '-F', msgFile])
    } catch {
      console.error('git commit failed. (Maybe nothing changed, or hooks failed.)')
      process.exit(1)
    } finally {
      try {
        fs.unlinkSync(msgFile)
      } catch {
        // ignore
      }
    }

    const createTag = await confirm(`Create annotated tag ${tag}?`, { defaultYes: true })
    if (!createTag) return

    logStep('Creating tag')
    try {
      runInherit('git', ['tag', '-a', tag, '-m', tagMessage])
    } catch {
      console.error('Failed to create tag. It may already exist.')
      process.exit(1)
    }

    const push = await confirm('Push commit + tag to origin (git push origin HEAD --follow-tags)?', {
      defaultYes: true
    })
    if (push) {
      logStep('Pushing to origin')
      runInherit('git', ['push', 'origin', 'HEAD', '--follow-tags'])
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
