import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ClientProfile } from '@/types'

export type ClientListCardProps = {
  clients: ClientProfile[]
  filteredClients: ClientProfile[]

  query: string
  onQueryChange: (value: string) => void

  selectedClientId: string | null
  onSelectClient: (id: string) => void
}

export function ClientListCard(props: ClientListCardProps): JSX.Element {
  const { clients, filteredClients, query, onQueryChange, selectedClientId, onSelectClient } = props

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Client List</CardTitle>
            <CardDescription>Search and select a profile.</CardDescription>
          </div>
          <div className="rounded-full border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            {clients.length} total
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <Input
          placeholder="Search by name or id…"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onQueryChange(e.target.value)}
        />

        {clients.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No clients yet. Create one to get started.
          </div>
        )}

        {clients.length > 0 && filteredClients.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No matches for “{query.trim()}”.
          </div>
        )}

        <div className="space-y-2">
          {filteredClients.map((client) => {
            const selected = selectedClientId === client.id
            return (
              <button
                key={client.id}
                className={`group w-full rounded-md border px-3 py-2 text-left text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? 'border-primary/60 bg-primary/10 text-foreground shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/30 hover:text-foreground'
                }`}
                onClick={() => onSelectClient(client.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{client.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{client.id}</div>
                  </div>
                  <div
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      selected ? 'bg-primary' : 'bg-muted group-hover:bg-primary/70'
                    }`}
                    aria-hidden="true"
                  />
                </div>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
