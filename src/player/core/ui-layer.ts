export const UI_LAYER = {
  hoverPreview: 70,
  floatingMenu: 160,
  header: 200,
  playlistTab: 210,
  playbackEnd: 260,
  toast: 300,
  modal: 10000000,
} as const

export const INTERACTIVE_SELECTOR = [
  '.m115-interactive',
  '.m115-layer-header',
  '.m115-layer-playback-end',
  '.m115-layer-playlist-tab',
  '.m115-playlist-sidebar',
  '.move-dialog-mask',
  '.move-dialog-box',
].join(', ')
