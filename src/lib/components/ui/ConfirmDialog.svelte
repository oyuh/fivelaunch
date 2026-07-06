<script lang="ts">
  import Modal from './Modal.svelte'
  import Button from './Button.svelte'

  let {
    open = $bindable(false),
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = true,
    onConfirm
  }: {
    open?: boolean
    title?: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    onConfirm?: () => void
  } = $props()

  function confirm(): void {
    open = false
    onConfirm?.()
  }
</script>

<Modal bind:open {title} icon={danger ? 'alert' : 'info'} size="sm">
  <p class="text-sm leading-relaxed text-muted-foreground">{message}</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{cancelLabel}</Button>
    <Button variant={danger ? 'destructive' : 'primary'} icon="check" onclick={confirm}>
      {confirmLabel}
    </Button>
  {/snippet}
</Modal>
