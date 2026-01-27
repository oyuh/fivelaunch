import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AppLogEntry } from '@/types'
import { Copy, Search, Trash2 } from 'lucide-react'

type Props = {
  logs: AppLogEntry[]
  defaultSource?: AppLogEntry['source']
  onClear?: () => void
}

const levelClass = (level: AppLogEntry['level']): string => {
  switch (level) {
    case 'error':
      return 'text-red-300'
    case 'warn':
      return 'text-amber-300'
    case 'debug':
      return 'text-slate-300'
    default:
      return 'text-emerald-200'
  }
}

export function LogsPanel({ logs, defaultSource = 'launch', onClear }: Props): JSX.Element {
  const [source, setSource] = useState<AppLogEntry['source']>(defaultSource)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = logs.filter((l) => l.source === source)
    if (!q) return base
    return base.filter((l) => l.message.toLowerCase().includes(q))
  }, [logs, query, source])

  // Auto-scroll when new logs arrive (if the user is already near the bottom).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (bottomGap < 80) {
      el.scrollTop = el.scrollHeight
    }
  }, [filtered.length])

  const copyVisible = async () => {
    const text = filtered
      .map((l) => `${new Date(l.ts).toLocaleTimeString()} [${l.level}] ${l.message}`)
      .join('\n')

    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Card className="w-full max-w-full">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Logs</CardTitle>
            <CardDescription>
              {source === 'launch'
                ? 'Launch progress and status messages.'
                : 'Main-process application logs.'}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-md border border-border bg-muted/30 p-1">
              <Button
                type="button"
                size="sm"
                variant={source === 'launch' ? 'secondary' : 'ghost'}
                className="h-8"
                onClick={() => setSource('launch')}
              >
                Launch
              </Button>
              <Button
                type="button"
                size="sm"
                variant={source === 'main' ? 'secondary' : 'ghost'}
                className="h-8"
                onClick={() => setSource('main')}
              >
                App
              </Button>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" size="sm" variant="secondary" onClick={copyVisible}>
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy visible logs</TooltipContent>
            </Tooltip>

            {onClear && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" size="sm" variant="secondary" onClick={onClear}>
                    <Trash2 className="h-4 w-4" />
                    Clear
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear all logs</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter logs…"
              className="pl-8"
            />
          </div>
          <div className="text-xs text-muted-foreground">{filtered.length} shown</div>
        </div>
      </CardHeader>

      <CardContent>
        <div
          ref={scrollerRef}
          className="h-[260px] w-full max-w-full overflow-y-auto overflow-x-hidden rounded-md border border-border bg-muted/20 p-3"
        >
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground">No logs yet.</div>
          ) : (
            <div className="min-w-0 space-y-1 font-mono text-xs">
              {filtered.map((l) => (
                <div key={`${l.source}-${l.id}`} className="flex min-w-0 gap-3">
                  <div className="w-[88px] shrink-0 text-muted-foreground">
                    {new Date(l.ts).toLocaleTimeString()}
                  </div>
                  <div className={`shrink-0 uppercase ${levelClass(l.level)}`}>{l.level}</div>
                  <div className="min-w-0 max-w-full flex-1 whitespace-pre-wrap break-words break-all text-foreground/90">
                    {l.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
