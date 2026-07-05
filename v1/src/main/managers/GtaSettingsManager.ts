import fs from 'fs'
import path from 'path'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import { getClientsDataPath, getGtaSettingsPath, getGtaSettingsCandidates } from '../utils/paths'

export interface GtaSettingsItem {
  path: string
  attributes: Record<string, string>
}

export interface GtaSettingsDocument {
  rootName: string
  items: GtaSettingsItem[]
}

export class GtaSettingsManager {
  private parser: XMLParser
  private builder: XMLBuilder

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      ignoreDeclaration: false,
      parseTagValue: false,
      trimValues: true,
      textNodeName: '#text',
      cdataPropName: '#cdata',
      commentPropName: '#comment'
    })

    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '    ',
          suppressEmptyNode: true,
      suppressBooleanAttributes: false,
      textNodeName: '#text',
      cdataPropName: '#cdata',
      suppressUnpairedNode: false,
      unpairedTags: []
    })
  }

  public getClientSettings(clientId: string): GtaSettingsDocument {
    const filePath = this.getClientSettingsPathForRead(clientId)
    const xml = this.readXmlSafe(filePath)
    return this.parseXmlToDocument(xml)
  }

  public saveClientSettings(clientId: string, doc: GtaSettingsDocument): void {
    const filePath = this.getClientSettingsPathForWrite(clientId)
    const xml = this.buildXmlFromDocument(doc)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, xml, 'utf8')
  }

  public importFromDocuments(clientId: string): GtaSettingsDocument {
    const candidates = getGtaSettingsCandidates()
    const sourcePath = candidates.find((candidate) => fs.existsSync(candidate))

    if (!sourcePath) {
      const fallback = getGtaSettingsPath()
      throw new Error(
        `GTA settings.xml not found. Checked: ${[...candidates, fallback].filter(Boolean).join(', ')}`
      )
    }
    const xml = fs.readFileSync(sourcePath, 'utf8')
    const doc = this.parseXmlToDocument(xml)
    this.saveClientSettings(clientId, doc)
    return doc
  }

  public importFromTemplate(clientId: string): GtaSettingsDocument {
    const templatePath = path.join(__dirname, '../../resources/settings-template.xml')

    if (!fs.existsSync(templatePath)) {
      throw new Error('Settings template not found. Please ensure settings-template.xml exists in resources folder.')
    }

    const xml = fs.readFileSync(templatePath, 'utf8')
    const doc = this.parseXmlToDocument(xml)
    this.saveClientSettings(clientId, doc)
    return doc
  }

  private getClientSettingsDir(clientId: string): string {
    return path.join(getClientsDataPath(), clientId, 'settings')
  }

  private getClientSettingsPathForWrite(clientId: string): string {
    return path.join(this.getClientSettingsDir(clientId), 'gta5_settings.xml')
  }

  private getClientSettingsPathForRead(clientId: string): string {
    const dir = this.getClientSettingsDir(clientId)
    const preferred = path.join(dir, 'gta5_settings.xml')
    if (fs.existsSync(preferred)) return preferred

    const legacy = path.join(dir, 'settings.xml')
    if (fs.existsSync(legacy)) return legacy

    return preferred
  }

  private readXmlSafe(filePath: string): string {
    if (!fs.existsSync(filePath)) return ''
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch {
      return ''
    }
  }

  private parseXmlToDocument(xml: string): GtaSettingsDocument {
    const trimmed = xml.trim()
    if (!trimmed) {
      return { rootName: 'Settings', items: [] }
    }

    try {
      const parsed = this.parser.parse(trimmed) as Record<string, unknown>

      console.log('[GtaSettingsManager] Parsed XML keys:', Object.keys(parsed))

      // Filter out XML declaration from root keys
      const rootKeys = Object.keys(parsed).filter(key => key !== '?xml')
      const rootName = rootKeys[0] || 'Settings'
      const rootNode = (parsed as Record<string, unknown>)[rootName]

      console.log('[GtaSettingsManager] Root name:', rootName)
      console.log('[GtaSettingsManager] Root node keys:', rootNode ? Object.keys(rootNode as Record<string, unknown>) : 'null')

      const items: GtaSettingsItem[] = []

      this.walkNode(rootNode, [rootName], items)

      console.log('[GtaSettingsManager] Total items extracted:', items.length)
      console.log('[GtaSettingsManager] First 5 items:', items.slice(0, 5))

      return { rootName, items }
    } catch (error) {
      console.error('[GtaSettingsManager] Parse error:', error)
      return { rootName: 'Settings', items: [] }
    }
  }

  private walkNode(
    node: unknown,
    pathParts: string[],
    items: GtaSettingsItem[]
  ): void {
    if (node === null || node === undefined) return

    if (Array.isArray(node)) {
      node.forEach((entry) => this.walkNode(entry, pathParts, items))
      return
    }

    // Handle primitive values (text content)
    if (typeof node !== 'object') {
      items.push({
        path: pathParts.join('/'),
        attributes: { '#text': String(node) }
      })
      return
    }

    const record = node as Record<string, unknown>

    // Skip XML declaration node
    const currentNodeName = pathParts[pathParts.length - 1]
    if (currentNodeName === '?xml') {
      return
    }

    const attributes: Record<string, string> = {}

    Object.entries(record).forEach(([key, value]) => {
      if (key.startsWith('@_')) {
        const attrValue = String(value ?? '')
        // Skip empty attributes - they cause GTA to reject the XML
        if (attrValue !== '' && attrValue !== 'null' && attrValue !== 'undefined') {
          attributes[key.slice(2)] = attrValue
        }
      } else if (key === '#text') {
        const textValue = String(value ?? '')
        if (textValue !== '' && textValue !== 'null' && textValue !== 'undefined') {
          attributes['#text'] = textValue
        }
      }
    })

    // Only add item if it has attributes or text content
    if (Object.keys(attributes).length > 0) {
      items.push({
        path: pathParts.join('/'),
        attributes
      })
    }

    // Traverse children (skip attributes and text content)
    Object.entries(record).forEach(([key, value]) => {
      if (key.startsWith('@_') || key === '#text') return
      // Skip XML declaration when traversing children
      if (key === '?xml') return
      this.walkNode(value, [...pathParts, key], items)
    })
  }

  private buildXmlFromDocument(doc: GtaSettingsDocument): string {
    const rootName = doc.rootName || 'Settings'
    const root: Record<string, unknown> = {}
    root[rootName] = {}
    const rootNode = root[rootName] as Record<string, unknown>

    // CRITICAL: Add configSource to prevent GTA from auto-detecting settings
    // SMC_USER tells GTA to respect manual settings instead of auto-detecting
    rootNode['configSource'] = 'SMC_USER'

    doc.items.forEach((item) => {
      const parts = item.path.split('/').filter(Boolean)
      const normalizedParts = parts[0] === rootName ? parts : [rootName, ...parts]
      if (normalizedParts.length === 0) return

      let node = rootNode

      if (normalizedParts.length === 1) {
        Object.entries(item.attributes).forEach(([attrKey, attrValue]) => {
          // Skip empty values - they cause GTA to reject/reset settings
          if (attrValue === '' || attrValue === null || attrValue === undefined) return

          if (attrKey === '#text') {
            node['#text'] = attrValue
          } else {
            node[`@_${attrKey}`] = attrValue
          }
        })
        return
      }

      for (let i = 1; i < normalizedParts.length; i += 1) {
        const key = normalizedParts[i]
        const isLeaf = i === normalizedParts.length - 1

        if (isLeaf) {
          if (!node[key] || typeof node[key] !== 'object') {
            node[key] = {}
          }
          const leaf = node[key] as Record<string, unknown>

          // Handle text content and attributes
          let hasValidAttributes = false
          Object.entries(item.attributes).forEach(([attrKey, attrValue]) => {
            // Skip empty values - they cause GTA to reject/reset settings
            if (attrValue === '' || attrValue === null || attrValue === undefined) return

            hasValidAttributes = true
            if (attrKey === '#text') {
              leaf['#text'] = attrValue
            } else {
              leaf[`@_${attrKey}`] = attrValue
            }
          })

                // Keep attribute-only nodes as attribute-only so the builder can emit self-closing tags.

          // If only has #text and no attributes, store value directly
          if (item.attributes['#text'] !== undefined &&
              item.attributes['#text'] !== '' &&
              Object.keys(item.attributes).length === 1) {
            node[key] = item.attributes['#text']
          } else if (!hasValidAttributes) {
            // If all attributes were empty, don't create the node at all
            delete node[key]
          }
        } else {
          if (!node[key] || typeof node[key] !== 'object') {
            node[key] = {}
          }
          node = node[key] as Record<string, unknown>
        }
      }
    })

    const xml = this.builder.build(root)
    if (xml.trimStart().startsWith('<?xml')) {
      return xml
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`
  }
}
