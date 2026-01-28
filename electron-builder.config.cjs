// Centralized electron-builder config so we can derive metadata dynamically (e.g., from GitHub tags).

const path = require('path')

// Keep package.json as the canonical source for most metadata.
// In CI release builds, we override the app version from the git tag.
// GitHub Actions provides GITHUB_REF_NAME like "v1.2.3" for tag builds.
const pkg = require('./package.json')

const parseTagVersion = (tag) => {
  if (!tag) return null
  const trimmed = String(tag).trim()
  const match = trimmed.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/)
  return match ? match[1] : null
}

const releaseTag =
  process.env.GITHUB_REF_NAME ||
  process.env.RELEASE_TAG ||
  process.env.APP_VERSION ||
  process.env.VERSION

const tagVersion = parseTagVersion(releaseTag)
const appVersion = tagVersion || pkg.version

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // "store" is much faster than default compression and avoids long build times.
  // Size increases a bit, but startup and CI turnaround improve significantly.
  compression: 'store',
  appId: 'com.lawsonhart.fivelaunch',
  productName: 'FiveLaunch',
  directories: {
    buildResources: 'resources'
  },
  // IMPORTANT: Do not include `dist/**` here.
  // `dist/` contains electron-builder outputs (e.g. win-unpacked/fast), and including it
  // makes the app package recursively include itself, blowing past the 4.2GB ASAR limit.
  files: [
    'out/**',
    'package.json',
    'resources/**',
    '!dist/**',
    '!**/*.map',
    '!**/*.tsbuildinfo',
    '!**/.DS_Store'
  ],
  extraResources: [{ from: 'resources', to: 'resources' }],

  // Ensure the packaged app and the EXE version info reflect the release tag when present.
  extraMetadata: {
    version: appVersion,
    zdescription: pkg.description,
    author: pkg.author
  },

  // These values show up in Windows file properties / Explorer hover.
  copyright: `Copyright © ${new Date().getFullYear()} Lawson Hart`,

  win: {
    icon: path.join('resources', 'Logo-Windows.ico'),
    artifactName: 'FiveLaunch.exe',
    target: ['portable'],

    // Sets CompanyName/Publisher in Windows metadata.
    publisherName: ['Lawson Hart']
  },

  mac: {
    icon: path.join('resources', 'Logo.png')
  },

  linux: {
    icon: path.join('resources', 'Logo.png'),
    target: ['AppImage', 'deb']
  }
}
