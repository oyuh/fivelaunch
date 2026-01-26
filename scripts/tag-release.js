#!/usr/bin/env node

const { execSync } = require('child_process')
const readline = require('readline')

const run = (cmd) => execSync(cmd, { stdio: 'pipe' }).toString().trim()

const printHeader = () => {
  console.log('FiveLaunch Tagging CLI')
  console.log('Tag format: vMAJOR.MINOR.PATCH (e.g., v1.2.3)')
  console.log('MAJOR = breaking, MINOR = features, PATCH = fixes')
  console.log('----------------------------------------------')
}

const listTags = () => {
  try {
    const tags = run('git tag --sort=-creatordate').split('\n').filter(Boolean)
    const latest = tags.slice(0, 10)
    console.log('Latest tags:')
    if (latest.length === 0) {
      console.log('  (none found)')
    } else {
      latest.forEach((t, i) => console.log(`  ${i + 1}. ${t}`))
    }
  } catch (e) {
    console.log('Could not list tags. Is git installed and this a git repo?')
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const ask = (q) => new Promise((res) => rl.question(q, res))

const main = async () => {
  printHeader()
  listTags()

  const tag = (await ask('\nEnter new tag (e.g., v1.2.3): ')).trim()
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    console.log('Invalid tag format. Use vMAJOR.MINOR.PATCH')
    rl.close()
    process.exit(1)
  }

  const desc = (await ask('Optional descriptor (e.g., "hotfix", "beta", leave empty): ')).trim()
  const annotatedMsg = desc ? `${tag} - ${desc}` : tag

  const confirm = (await ask(`\nCreate and push tag ${tag}? (y/N): `)).trim().toLowerCase()
  if (confirm !== 'y') {
    console.log('Aborted.')
    rl.close()
    return
  }

  try {
    execSync(`git tag -a ${tag} -m "${annotatedMsg}"`, { stdio: 'inherit' })
    execSync(`git push origin ${tag}`, { stdio: 'inherit' })
    console.log(`Tag ${tag} pushed successfully.`)
  } catch (e) {
    console.error('Failed to create or push tag.')
    process.exit(1)
  } finally {
    rl.close()
  }
}

main()
