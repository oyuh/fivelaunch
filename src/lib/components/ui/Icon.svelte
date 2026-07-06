<script lang="ts">
  import { UI_ICONS } from './icons'

  let {
    name,
    svg,
    size = 16,
    stroke = 2,
    class: klass = ''
  }: {
    /** A key from UI_ICONS. Ignored if `svg` is provided. */
    name?: string
    /** Raw inner SVG markup (e.g. from clientIconSvg()). */
    svg?: string
    size?: number
    stroke?: number
    class?: string
  } = $props()

  const body = $derived(svg ?? (name ? (UI_ICONS[name] ?? '') : ''))
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={klass}
  aria-hidden="true"
>
  {@html body}
</svg>
