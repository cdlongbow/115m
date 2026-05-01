export interface MediaWallFolderItem {
  id: string
  title: string
  coverUrl: string
  sourceItem: HTMLElement
  isStarred: boolean
  hasRemark: boolean
  starAction: HTMLElement | null
  remarkAction: HTMLElement | null
  open: () => void
}

export interface MediaWallImageItem {
  id: string
  title: string
  thumbUrl: string
  originalUrl: string
  fileId: string
  parentId: string
  pickCode: string
  sourceItem: HTMLElement
}

export interface LightboxController {
  open: (items: MediaWallImageItem[], startIndex: number) => void
}
