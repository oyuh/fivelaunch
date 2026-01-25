import { resolve } from 'path'
import { execSync } from 'child_process'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const REPO_OWNER = 'oyuh'
const REPO_NAME = 'fivelaunch'
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`
const API_LATEST_COMMIT = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=1`

const fetchLatestCommit = async () => {
  try {
    const response = await fetch(API_LATEST_COMMIT, {
      headers: {
        'User-Agent': 'FiveLaunch'
      }
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const data = (await response.json()) as Array<{
      sha: string
      html_url: string
      commit: { message: string; author: { date: string } }
    }>

    const latest = data[0]
    if (!latest) throw new Error('No commits found')

    return {
      sha: latest.sha,
      shortSha: latest.sha.slice(0, 7),
      message: latest.commit.message,
      date: latest.commit.author.date,
      url: latest.html_url,
      apiUrl: `${REPO_URL}/commit/${latest.sha}`.replace('https://github.com', 'https://api.github.com/repos')
    }
  } catch {
    return null
  }
}

const getLocalGitCommit = () => {
  try {
    const sha = execSync('git rev-parse HEAD').toString().trim()
    const message = execSync('git log -1 --pretty=%B').toString().trim()
    const date = execSync('git log -1 --pretty=%cI').toString().trim()
    return {
      sha,
      shortSha: sha.slice(0, 7),
      message,
      date,
      url: `${REPO_URL}/commit/${sha}`,
      apiUrl: `${REPO_URL}/commit/${sha}`.replace('https://github.com', 'https://api.github.com/repos')
    }
  } catch {
    return null
  }
}

export default defineConfig(async ({ command }) => {
  const isBuild = command === 'build'
  const latestCommit = isBuild ? (await fetchLatestCommit()) ?? getLocalGitCommit() : null

  return {
    main: {
      plugins: [externalizeDepsPlugin()]
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@': resolve('src/renderer/src')
        }
      },
      define: {
        __COMMIT_INFO__: JSON.stringify(latestCommit),
        __REPO_URL__: JSON.stringify(REPO_URL),
        __SUPPORT_URL__: JSON.stringify(`${REPO_URL}/issues`)
      },
      plugins: [react()]
    }
  }
})
