export function runPlayerSmokeChecks(): void {
  const required = ['artplayer-app', 'loading']
  const missing = required.filter(id => !document.getElementById(id))
  if (missing.length > 0) {
    console.warn('[115m][Smoke] Missing required DOM nodes:', missing)
  }
}
