import type { ClientManager } from '../managers/ClientManager'
import type { GameManager } from '../managers/GameManager'
import type { SettingsManager } from '../managers/SettingsManager'
import type { GtaSettingsManager } from '../managers/GtaSettingsManager'

/**
 * Lazy-loading manager access.
 *
 * Keeping these as dynamic imports prevents blocking the first paint while
 * still providing a single shared instance of each manager.
 */

export type ManagerGetters = {
  getClientManager: () => Promise<ClientManager>
  getGameManager: () => Promise<GameManager>
  getSettingsManager: () => Promise<SettingsManager>
  getGtaSettingsManager: () => Promise<GtaSettingsManager>
}

/**
 * Creates a set of memoized async getters for managers.
 *
 * @param startupMark Called with human-readable milestones.
 */
export function createManagerGetters(startupMark: (label: string) => void): ManagerGetters {
  let clientManager: ClientManager | null = null
  let gameManager: GameManager | null = null
  let settingsManager: SettingsManager | null = null
  let gtaSettingsManager: GtaSettingsManager | null = null

  const getClientManager = async (): Promise<ClientManager> => {
    if (clientManager) return clientManager
    startupMark('Loading ClientManager…')
    const mod = await import('../managers/ClientManager')
    clientManager = new mod.ClientManager()
    startupMark('ClientManager ready')
    return clientManager
  }

  const getGameManager = async (): Promise<GameManager> => {
    if (gameManager) return gameManager
    startupMark('Loading GameManager…')
    const mod = await import('../managers/GameManager')
    gameManager = new mod.GameManager()
    startupMark('GameManager ready')
    return gameManager
  }

  const getSettingsManager = async (): Promise<SettingsManager> => {
    if (settingsManager) return settingsManager
    startupMark('Loading SettingsManager…')
    const mod = await import('../managers/SettingsManager')
    settingsManager = new mod.SettingsManager()
    startupMark('SettingsManager ready')
    return settingsManager
  }

  const getGtaSettingsManager = async (): Promise<GtaSettingsManager> => {
    if (gtaSettingsManager) return gtaSettingsManager
    startupMark('Loading GtaSettingsManager…')
    const mod = await import('../managers/GtaSettingsManager')
    gtaSettingsManager = new mod.GtaSettingsManager()
    startupMark('GtaSettingsManager ready')
    return gtaSettingsManager
  }

  return { getClientManager, getGameManager, getSettingsManager, getGtaSettingsManager }
}
