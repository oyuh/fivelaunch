<script lang="ts">
  import Dialog from './ui/Dialog.svelte'
  import { api } from '../api'

  let {
    open = $bindable(false),
    onContinue
  }: {
    open?: boolean
    onContinue: () => void
  } = $props()
</script>

<Dialog
  bind:open
  title="Welcome to FiveLaunch"
  description="Before linking files, please back up your original FiveM data. We will rename existing folders and settings files the first time you link a client."
>
  <div class="mt-3 space-y-4 text-sm">
    <div class="rounded-md border border-border p-4">
      <div class="font-medium">Back up these items</div>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>FiveM.app folders: mods, plugins, citizen</li>
        <li>GTA settings: settings.xml</li>
        <li>CitizenFX.ini</li>
      </ul>
    </div>

    <div class="rounded-md border border-border p-4">
      <div class="font-medium">Where they live</div>
      <div class="mt-2 space-y-1 text-muted-foreground">
        <div>CitizenFX folder: <span class="text-foreground">%APPDATA%\CitizenFX</span></div>
        <div>FiveM app data: <span class="text-foreground">%LOCALAPPDATA%\FiveM\FiveM.app</span></div>
        <div>
          GTA V settings:
          <span class="text-foreground">%USERPROFILE%\Documents\Rockstar Games\GTA V\settings.xml</span>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onclick={() => api.openCitizenFxFolder().catch(() => {})}
        >
          Open CitizenFX Folder
        </button>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onclick={() => api.openFiveMFolder().catch(() => {})}
        >
          Open FiveM Folder
        </button>
      </div>
    </div>

    <div class="flex items-center justify-end">
      <button
        class="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        onclick={onContinue}
      >
        I Understand
      </button>
    </div>
  </div>
</Dialog>
