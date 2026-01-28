import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type ActionTileProps = {
  title: string
  description: string
  icon: JSX.Element
  onClick: () => void
  disabled?: boolean
  disabledReason?: string
}

export function ActionTile(props: ActionTileProps): JSX.Element {
  const { title, description, icon, onClick, disabled, disabledReason } = props

  const content = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex min-h-[96px] w-full flex-col items-start justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        disabled
          ? 'cursor-not-allowed border-border bg-muted/20 opacity-60'
          : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/30'
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
            disabled
              ? 'border-border bg-muted/30 text-muted-foreground'
              : 'border-primary/20 bg-primary/10 text-primary'
          }`}
        >
          {icon}
        </div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
      </div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </button>
  )

  if (!disabled || !disabledReason) return content

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  )
}
