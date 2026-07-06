import type { Action } from 'svelte/action'

/**
 * Custom themed tooltip. Attach with `use:tooltip={'text'}` on any element to
 * replace the native browser tooltip. The bubble is appended to <body> (so it
 * escapes overflow/stacking contexts) and styled by `.app-tooltip` in app.css.
 * Passing an empty/undefined value disables it.
 */
export const tooltip: Action<HTMLElement, string | undefined> = (node, text) => {
  let content = text
  let tip: HTMLDivElement | null = null
  let showTimer: ReturnType<typeof setTimeout> | undefined

  function place(): void {
    if (!tip) return
    const r = node.getBoundingClientRect()
    const tr = tip.getBoundingClientRect()
    const gap = 8
    let top = r.top - tr.height - gap
    if (top < 4) top = r.bottom + gap // flip below if no room above
    let left = r.left + r.width / 2 - tr.width / 2
    left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6))
    tip.style.top = `${Math.round(top)}px`
    tip.style.left = `${Math.round(left)}px`
  }

  function show(): void {
    if (tip || !content) return
    tip = document.createElement('div')
    tip.className = 'app-tooltip'
    tip.setAttribute('role', 'tooltip')
    tip.textContent = content
    document.body.appendChild(tip)
    place()
    requestAnimationFrame(() => tip?.setAttribute('data-show', 'true'))
    window.addEventListener('scroll', hide, true)
  }

  function hide(): void {
    if (showTimer) clearTimeout(showTimer)
    showTimer = undefined
    window.removeEventListener('scroll', hide, true)
    tip?.remove()
    tip = null
  }

  function onEnter(): void {
    if (!content) return
    showTimer = setTimeout(show, 300)
  }

  node.addEventListener('mouseenter', onEnter)
  node.addEventListener('mouseleave', hide)
  node.addEventListener('mousedown', hide)
  node.addEventListener('focusin', show)
  node.addEventListener('focusout', hide)

  return {
    update(next) {
      content = next
      if (!content) hide()
      else if (tip) {
        tip.textContent = content
        place()
      }
    },
    destroy() {
      hide()
      node.removeEventListener('mouseenter', onEnter)
      node.removeEventListener('mouseleave', hide)
      node.removeEventListener('mousedown', hide)
      node.removeEventListener('focusin', show)
      node.removeEventListener('focusout', hide)
    }
  }
}
