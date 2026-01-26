#!/usr/bin/env node

/**
 * Zip the dist folder (Windows-friendly release artifact).
 * Produces: dist/FiveLaunch-windows.zip
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const distDir = path.join(process.cwd(), 'dist')
const outZip = path.join(distDir, 'FiveLaunch-windows.zip')

const main = () => {
  if (!fs.existsSync(distDir)) {
    console.error('dist folder not found:', distDir)
    process.exit(1)
  }

  if (fs.existsSync(outZip)) {
    fs.unlinkSync(outZip)
  }

  // Use PowerShell Compress-Archive on Windows runners.
  // -Force overwrites any existing file.
  const ps = `Compress-Archive -Path \"${distDir.replace(/\\/g, '\\\\')}\\*\" -DestinationPath \"${outZip.replace(/\\/g, '\\\\')}\" -Force`
  execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' })
}

main()
