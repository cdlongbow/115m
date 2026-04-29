export function bindClickSelectorBehavior(control: HTMLElement) {
  if ((control as any).__m115SelectorBound) {
    return
  }
  ;(control as any).__m115SelectorBound = true
  control.classList.add('m115-click-selector')

  const close = () => {
    control.classList.remove('m115-selector-open')
  }

  const open = () => {
    const scope = control.parentElement || document
    scope.querySelectorAll<HTMLElement>('.m115-click-selector.m115-selector-open').forEach((node) => {
      if (node !== control) {
        node.classList.remove('m115-selector-open')
      }
    })
    control.classList.add('m115-selector-open')
  }

  control.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.art-selector-item')) {
      close()
      return
    }

    const selectorValue = target?.closest('.art-selector-value')
    if (!selectorValue) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (control.classList.contains('m115-selector-open')) {
      close()
    }
    else {
      open()
    }
  })

  document.addEventListener('click', (event) => {
    if (!control.contains(event.target as Node)) {
      close()
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close()
    }
  })
}
