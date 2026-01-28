import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { GtaSettingsItem } from '@/types'
import { getSettingDefinition, SETTING_CATEGORIES, type SettingOption } from '@shared/gtaSettingsMap'

export type GtaSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void

  selectedClientId: string | null

  rootName: string
  items: GtaSettingsItem[]

  loading: boolean
  error: string | null
  dirty: boolean

  onImportFromGame: () => void
  onLoadFullExample: () => void
  onSave: () => void

  onUpdateAttribute: (itemId: string, attrKey: string, newValue: string) => void
}

const humanizeKey = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()

function renderAttributeInput(
  settingName: string,
  value: string,
  onUpdate: (newValue: string) => void,
  showLabel = true
) {
  const settingDef = getSettingDefinition(settingName)

  if (settingDef?.type === 'select' && settingDef.options) {
    return (
      <div className="flex flex-col gap-1">
        {showLabel && <span className="text-xs font-medium text-muted-foreground">{humanizeKey(settingName)}</span>}
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={value}
          onChange={(e) => onUpdate(e.target.value)}
        >
          {settingDef.options.map((opt: SettingOption) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (settingDef?.type === 'slider') {
    const numValue = parseFloat(value) || 0
    return (
      <div className="flex flex-col gap-1">
        {showLabel && <span className="text-xs font-medium text-muted-foreground">{humanizeKey(settingName)}</span>}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={settingDef.min}
            max={settingDef.max}
            step={settingDef.step}
            value={numValue}
            className="flex-1"
            onChange={(e) => onUpdate(e.target.value)}
          />
          <span className="text-xs font-mono text-muted-foreground w-12 text-right">{numValue.toFixed(2)}</span>
        </div>
      </div>
    )
  }

  const numeric = Number(value)
  const isNumeric = !Number.isNaN(numeric) && value.trim() !== ''
  const step = Number.isInteger(numeric) ? 1 : 0.01

  return (
    <div className="flex flex-col gap-1">
      {showLabel && <span className="text-xs font-medium text-muted-foreground">{humanizeKey(settingName)}</span>}
      <Input
        type={isNumeric ? 'number' : 'text'}
        value={value}
        step={isNumeric ? step : undefined}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(e.target.value)}
      />
    </div>
  )
}

export function GtaSettingsDialog(props: GtaSettingsDialogProps): JSX.Element {
  const {
    open,
    onOpenChange,
    selectedClientId,
    rootName,
    items,
    loading,
    error,
    dirty,
    onImportFromGame,
    onLoadFullExample,
    onSave,
    onUpdateAttribute
  } = props

  const categorizedSettings = useMemo(() => {
    const categories: Record<string, GtaSettingsItem[]> = {}

    items.forEach((item) => {
      const parts = item.path.split('/').filter(Boolean)
      const settingName = parts[parts.length - 1]

      const firstAttrKey = Object.keys(item.attributes)[0]
      const settingDef = getSettingDefinition(settingName || firstAttrKey)

      const category = settingDef?.category || 'Other'

      if (!categories[category]) {
        categories[category] = []
      }
      categories[category].push(item)
    })

    const sorted: Record<string, GtaSettingsItem[]> = {}
    SETTING_CATEGORIES.forEach((cat: string) => {
      if (categories[cat] && categories[cat].length > 0) {
        sorted[cat] = categories[cat]
      }
    })

    if (categories['Other'] && categories['Other'].length > 0) {
      sorted['Other'] = categories['Other']
    }

    return sorted
  }, [items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>GTA V Settings Editor</DialogTitle>
          <DialogDescription>
            Edit this client&apos;s settings.xml. These values are saved in the client folder and copied into Documents
            when you launch with GTA Settings enabled.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Root element:</span>
            <span className="font-medium text-foreground">{rootName}</span>
            <span className="text-muted-foreground">·</span>
            <span>{items.length} entries</span>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-4">
              {Object.keys(categorizedSettings).length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No settings found in settings.xml.
                </div>
              ) : (
                Object.entries(categorizedSettings).map(([category, items]) => (
                  <div key={category} className="rounded-md border border-border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="h-1 w-1 rounded-full bg-primary" />
                      <div className="text-sm font-semibold text-foreground">{category}</div>
                      <div className="text-xs text-muted-foreground">({items.length})</div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {items.map((item) => {
                        const parts = item.path.split('/').filter(Boolean)
                        const settingName = parts[parts.length - 1]
                        const entries = Object.entries(item.attributes)

                        return entries.map(([attrKey, value]) => (
                          <div key={`${item.id}-${attrKey}`} className="rounded-md border border-border bg-card p-3">
                            {renderAttributeInput(settingName, value, (newValue) => onUpdateAttribute(item.id, attrKey, newValue), true)}
                          </div>
                        ))
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={!selectedClientId || loading} onClick={onImportFromGame}>
                Import from Game
              </Button>
              <Button variant="outline" disabled={!selectedClientId || loading} onClick={onLoadFullExample}>
                Load Full Example
              </Button>
              <Button variant="default" disabled={!selectedClientId || !dirty || loading} onClick={onSave}>
                Save Changes
              </Button>
            </div>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
