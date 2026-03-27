export interface BreadcrumbItem {
  cid: string
  name: string
}

export interface FileInfo {
  pickCode: string
  fileName: string
  duration: number
  isVideo: boolean
  fileId?: string
  parentId?: string
  fileSize?: string
  isMarked?: boolean
  breadcrumbs?: BreadcrumbItem[]
}
