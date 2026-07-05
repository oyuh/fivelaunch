type GithubLatestReleaseResponse = {
  tag_name?: string
  html_url?: string
}

type GithubTagResponse = {
  name?: string
}

export type UpdateStatus = {
  currentVersion: string
  latestVersion: string | null
  latestUrl: string | null
  isUpdateAvailable: boolean
  checkedAt: number
  source: 'releases-latest' | 'tags-latest' | 'error'
  error?: string
}

const normalizeVersion = (v: string): string => String(v || '').trim().replace(/^v/i, '')

const parseSemver = (
  v: string
): { major: number; minor: number; patch: number; prerelease: string | null } | null => {
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

const compareSemver = (a: string, b: string): number => {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0

  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch

  // Pre-release is considered lower than stable.
  if (!pa.prerelease && pb.prerelease) return 1
  if (pa.prerelease && !pb.prerelease) return -1
  if (!pa.prerelease && !pb.prerelease) return 0

  return String(pa.prerelease).localeCompare(String(pb.prerelease))
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, {
    headers: {
      // GitHub API requires a UA.
      'User-Agent': 'FiveLaunch',
      Accept: 'application/vnd.github+json'
    }
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as T
}

export const checkForUpdatesOnGitHub = async (args: {
  repo: string
  currentVersion: string
}): Promise<UpdateStatus> => {
  const { repo, currentVersion } = args
  const checkedAt = Date.now()

  try {
    // Prefer releases/latest since it represents the actual published release.
    const release = await fetchJson<GithubLatestReleaseResponse>(
      `https://api.github.com/repos/${repo}/releases/latest`
    )

    const latestVersion = release.tag_name ? normalizeVersion(release.tag_name) : null
    const latestUrl = release.html_url || (release.tag_name ? `https://github.com/${repo}/releases/tag/${release.tag_name}` : null)

    const isUpdateAvailable =
      Boolean(latestVersion) && compareSemver(latestVersion!, currentVersion) > 0

    return {
      currentVersion: normalizeVersion(currentVersion),
      latestVersion,
      latestUrl,
      isUpdateAvailable,
      checkedAt,
      source: 'releases-latest'
    }
  } catch (error) {
    // Fallback: tags list.
    try {
      const tags = await fetchJson<GithubTagResponse[]>(
        `https://api.github.com/repos/${repo}/tags?per_page=1`
      )

      const latestTag = tags[0]?.name ? String(tags[0].name) : null
      const latestVersion = latestTag ? normalizeVersion(latestTag) : null
      const latestUrl = latestTag ? `https://github.com/${repo}/releases/tag/${latestTag}` : null

      const isUpdateAvailable =
        Boolean(latestVersion) && compareSemver(latestVersion!, currentVersion) > 0

      return {
        currentVersion: normalizeVersion(currentVersion),
        latestVersion,
        latestUrl,
        isUpdateAvailable,
        checkedAt,
        source: 'tags-latest'
      }
    } catch (fallbackError) {
      return {
        currentVersion: normalizeVersion(currentVersion),
        latestVersion: null,
        latestUrl: null,
        isUpdateAvailable: false,
        checkedAt,
        source: 'error',
        error: (fallbackError as Error)?.message || (error as Error)?.message || 'Unknown error'
      }
    }
  }
}
