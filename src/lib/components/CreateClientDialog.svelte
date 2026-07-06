<script lang="ts">
  import Modal from './ui/Modal.svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import Icon from './ui/Icon.svelte'
  import { CLIENT_ICONS, DEFAULT_CLIENT_ICON } from './ui/icons'
  import { tooltip } from '../actions/tooltip'
  import { api } from '../api'
  import type { ClientProfile } from '../types'

  let {
    open = $bindable(false),
    onCreated
  }: {
    open?: boolean
    /** Called with the freshly created client so the caller can select it. */
    onCreated?: (client: ClientProfile) => void
  } = $props()

  let name = $state('')
  let icon = $state(DEFAULT_CLIENT_ICON)
  let creating = $state(false)
  let error = $state<string | null>(null)

  // Reset each time the dialog opens.
  $effect(() => {
    if (open) {
      name = ''
      icon = DEFAULT_CLIENT_ICON
      error = null
      creating = false
    }
  })

  async function create(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    creating = true
    error = null
    try {
      const created = await api.createClient(trimmed, icon)
      onCreated?.(created)
      open = false
    } catch (e) {
      error = String(e)
    } finally {
      creating = false
    }
  }
</script>

<Modal
  bind:open
  title="New client"
  description="Name it and pick an icon."
  icon="plus"
  size="md"
>
  <div class="space-y-5">
    <div class="space-y-1.5">
      <label for="new-client-name" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Name
      </label>
      <Input
        id="new-client-name"
        bind:value={name}
        placeholder="e.g. Main RP"
        autofocus
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && create()}
      />
    </div>

    <div class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Icon</p>
      <div class="grid grid-cols-10 gap-2">
        {#each CLIENT_ICONS as ic (ic.key)}
          <button
            type="button"
            use:tooltip={ic.label}
            aria-label={ic.label}
            aria-pressed={icon === ic.key}
            class="flex aspect-square items-center justify-center rounded-md transition-colors
              {icon === ic.key
              ? 'bg-accent-wash text-primary ring-1 ring-primary/50'
              : 'bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground'}"
            onclick={() => (icon = ic.key)}
          >
            <Icon svg={ic.svg} size={18} />
          </button>
        {/each}
      </div>
    </div>

    {#if error}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</div>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" icon="plus" disabled={!name.trim()} loading={creating} onclick={create}>
      Create client
    </Button>
  {/snippet}
</Modal>
