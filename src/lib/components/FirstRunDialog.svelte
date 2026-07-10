<script lang="ts">
  import Modal from './ui/Modal.svelte'
  import Button from './ui/Button.svelte'
  import Checkbox from './ui/Checkbox.svelte'
  import { api } from '../api'
  import logo from '../../assets/logo.png'

  let {
    open = $bindable(false),
    onContinue,
    onSnapshotCreated
  }: {
    open?: boolean
    onContinue: () => void
    /** Called after the snapshot client is created so the app can refresh. */
    onSnapshotCreated?: () => void
  } = $props()

  let backedUp = $state(false)
  let creatingSnapshot = $state(false)
  let snapshotError = $state<string | null>(null)

  // Require the backup confirmation again each time the dialog is shown.
  $effect(() => {
    if (open) {
      backedUp = false
      creatingSnapshot = false
      snapshotError = null
    }
  })

  async function snapshotAndContinue(): Promise<void> {
    if (creatingSnapshot) return
    creatingSnapshot = true
    snapshotError = null
    try {
      await api.createSnapshotClient()
      onSnapshotCreated?.()
      onContinue()
    } catch (e) {
      snapshotError = String(e)
    } finally {
      creatingSnapshot = false
    }
  }
</script>

<Modal
  bind:open
  title="Welcome to FiveLaunch"
  description="A quick heads-up before you link your first client."
  icon="info"
  size="md"
>
  <div class="space-y-4 text-sm">
    <!-- Brand -->
    <div class="flex items-center gap-3">
      <span
        class="pointer-events-none block h-6 shrink-0 bg-foreground"
        style="width: 2.55rem; -webkit-mask: url('{logo}') center / contain no-repeat; mask: url('{logo}') center / contain no-repeat;"
        role="img"
        aria-label="FiveLaunch"
      ></span>
      <div>
        <p class="font-display text-base font-bold leading-none">FiveLaunch</p>
        <p class="mt-1 text-xs text-muted-foreground">FiveM profile launcher · fivelaunch.help</p>
      </div>
    </div>

    <!-- What it does -->
    <div class="rounded-lg bg-surface-2/60 p-4">
      <div class="font-medium">What it does</div>
      <p class="mt-1 text-muted-foreground">
        Keep multiple FiveM setups (clients), each with its own mods, plugins, citizen data, and GTA V
        settings. Launch one and FiveLaunch swaps those files into FiveM for you, then restores
        everything after you play.
      </p>
    </div>

    <!-- Back up -->
    <div class="rounded-lg bg-surface-2/60 p-4">
      <div class="font-medium">Back these up first</div>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>FiveM.app folders: mods, plugins, citizen</li>
        <li>GTA settings: settings.xml</li>
        <li>CitizenFX.ini</li>
      </ul>
      <p class="mt-2 text-xs text-muted-foreground">
        The first time you link a client, FiveLaunch moves your existing files into a managed backups
        folder (you can restore them anytime from History).
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          icon="folder"
          onclick={() => api.openCitizenFxFolder().catch(() => {})}
        >
          CitizenFX folder
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon="folder"
          onclick={() => api.openFiveMFolder().catch(() => {})}
        >
          FiveM folder
        </Button>
      </div>
    </div>

    <!-- Snapshot -->
    <div class="rounded-lg bg-surface-2/60 p-4">
      <div class="font-medium">Your setup becomes a client</div>
      <p class="mt-1 text-muted-foreground">
        FiveLaunch snapshots your current FiveM files into a client called
        <span class="font-medium text-foreground">My Setup</span>. After every session, whatever a
        client swapped in goes back to this snapshot — so closing the game always returns FiveM to
        the setup you have right now.
      </p>
    </div>

    <!-- Required confirmation -->
    <div class="rounded-lg border border-primary/30 bg-accent-wash p-4">
      <Checkbox bind:checked={backedUp}>
        I've backed up my FiveM data (or I understand my existing files will be moved into
        FiveLaunch's managed backups).
      </Checkbox>
    </div>

    {#if snapshotError}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        Snapshot failed: {snapshotError}
        <p class="mt-1 text-xs text-muted-foreground">
          You can continue and create the snapshot later from Settings.
        </p>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" disabled={!backedUp || creatingSnapshot} onclick={onContinue}>
      Skip snapshot
    </Button>
    <Button
      variant="primary"
      icon="check"
      disabled={!backedUp}
      loading={creatingSnapshot}
      onclick={snapshotAndContinue}
    >
      Snapshot my setup & continue
    </Button>
  {/snippet}
</Modal>
