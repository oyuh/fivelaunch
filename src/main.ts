import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// Suppress the webview's browser-style context menu — right-click does
// nothing anywhere in the app. (The `bun run ui` preview keeps it.)
window.addEventListener('contextmenu', (event) => event.preventDefault())

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
