#!/usr/bin/env node

/**
 * Make the Windows "dist" output behave like the fast win-unpacked build.
 *
 * electron-builder's "portable" target is a self-extracting executable and can be slow to start.
 * The unpacked build starts much faster because it doesn't unpack every launch.
 *
 * This script copies the contents of dist/win-unpacked into dist/ so dist/FiveLaunch.exe
 * is the unpacked executable with its required adjacent files.
 */

const fs = require('fs')
const path = require('path')

const projectRoot = process.cwd()
const distDir = path.join(projectRoot, 'dist')
const unpackedDir = path.join(distDir, 'win-unpacked')

const exists = (p) => {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

const copyRecursive = (src, dst) => {
  const stat = fs.lstatSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dst, entry))
    }
    return
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
}

const main = () => {
  if (!exists(distDir)) {
    console.error('dist folder not found:', distDir)
    process.exit(1)
  }

  if (!exists(unpackedDir)) {
    console.error('win-unpacked folder not found:', unpackedDir)
    console.error('Make sure you built with: electron-builder --win dir')
    process.exit(1)
  }

  // Safety: don't copy over an existing portable exe at dist/FiveLaunch.exe
  // We'll overwrite it, but keep a backup if present.
  const distExe = path.join(distDir, 'FiveLaunch.exe')
  if (exists(distExe)) {
    const backup = path.join(distDir, 'FiveLaunch-Portable.exe')
    try {
      if (exists(backup)) {
        fs.unlinkSync(backup)
      }
      fs.renameSync(distExe, backup)
      console.log('Backed up existing dist/FiveLaunch.exe ->', path.basename(backup))
    } catch {
      // ignore
    }
  }

  // Copy everything from win-unpacked to dist root.
  for (const entry of fs.readdirSync(unpackedDir)) {
    copyRecursive(path.join(unpackedDir, entry), path.join(distDir, entry))
  }

  console.log('Copied win-unpacked contents into dist/.')
  console.log('Fast EXE:', path.join(distDir, 'FiveLaunch.exe'))
}

main()
