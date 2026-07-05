<script lang="ts">
  import Dialog from './ui/Dialog.svelte'
  import { api } from '../api'
  import type { ClientProfile } from '../types'

  let {
    open = $bindable(false),
    client
  }: {
    open?: boolean
    client: ClientProfile | null
  } = $props()

  let error = $state<string | null>(null)

  function run(action: Promise<void>): void {
    error = null
    action.catch((e) => (error = String(e)))
  }
</script>

<Dialog bind:open title="Refs" description="Quick links to open useful folders.">
  <div class="mt-3 grid gap-2 sm:grid-cols-2">
    <button
      class="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
      disabled={!client}
      onclick={() => client && run(api.openClientFolder(client.id))}
    >
      Client Folder
    </button>
    <button
      class="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
      disabled={!client}
      onclick={() => client && run(api.openClientPluginsFolder(client.id))}
    >
      Client Plugins
    </button>
    <button
      class="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => run(api.openFiveMFolder())}
    >
      FiveM Folder
    </button>
    <button
      class="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => run(api.openFiveMPluginsFolder())}
    >
      FiveM Plugins
    </button>
    <button
      class="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => run(api.openCitizenFxFolder())}
    >
      CitizenFX Folder
    </button>
    <button
      class="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => (open = false)}
    >
      Close
    </button>
  </div>

  {#if error}
    <div class="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      {error}
    </div>
  {/if}
</Dialog>
