import '@testing-library/jest-dom/vitest'

// Svelte 5 transitions (used by Modal/Menu) call the Web Animations API, which
// jsdom does not implement. Provide a minimal stub that settles immediately so
// intro/outro transitions complete (and outro nodes get removed) in tests.
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = function animate() {
    const anim = {
      onfinish: null as null | (() => void),
      oncancel: null as null | (() => void),
      finished: Promise.resolve(),
      cancel() {},
      play() {},
      pause() {},
      finish() {},
      reverse() {},
      commitStyles() {},
      persist() {},
      updatePlaybackRate() {},
      addEventListener() {},
      removeEventListener() {}
    }
    // Let Svelte assign onfinish, then fire it so transitions resolve.
    setTimeout(() => anim.onfinish?.(), 0)
    return anim as unknown as Animation
  }
}
