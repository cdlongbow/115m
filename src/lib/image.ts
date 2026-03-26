export function getImageResize(originalWidth: number, originalHeight: number, maxWidth: number, maxHeight: number): { width: number, height: number } {
  let width = originalWidth
  let height = originalHeight

  if (width > height) {
    if (width > maxWidth) {
      height = Math.round(height * (maxWidth / width))
      width = maxWidth
    }
  } else {
    if (height > maxHeight) {
      width = Math.round(width * (maxHeight / height))
      height = maxHeight
    }
  }

  return { width, height }
}
