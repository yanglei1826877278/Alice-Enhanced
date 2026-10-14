export type ChatAttachmentKind = 'image' | 'pdf' | 'unsupported'

export const CHAT_ATTACHMENT_ACCEPT =
  'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp'

export const MAX_CHAT_IMAGE_BYTES = 14 * 1024 * 1024
export const MAX_CHAT_PDF_BYTES = 32 * 1024 * 1024
export const MAX_CHAT_ATTACHMENTS = 6

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

export function getChatAttachmentKind(
  file: Pick<File, 'name' | 'type'>
): ChatAttachmentKind {
  const mimeType = file.type.toLowerCase()
  const fileName = file.name.toLowerCase()

  if (
    IMAGE_MIME_TYPES.has(mimeType) ||
    IMAGE_EXTENSIONS.some(extension => fileName.endsWith(extension))
  ) {
    return 'image'
  }
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return 'pdf'
  }
  return 'unsupported'
}

export function getChatImageMimeType(
  file: Pick<File, 'name' | 'type'>
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const mimeType = file.type.toLowerCase()
  if (mimeType === 'image/png' || mimeType === 'image/webp') return mimeType
  if (mimeType === 'image/jpeg') return 'image/jpeg'

  const fileName = file.name.toLowerCase()
  if (fileName.endsWith('.png')) return 'image/png'
  if (fileName.endsWith('.webp')) return 'image/webp'
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  return null
}

export function validateChatAttachment(
  file: Pick<File, 'name' | 'type' | 'size'>
): string | null {
  const kind = getChatAttachmentKind(file)
  if (kind === 'unsupported') {
    return 'Only PNG, JPG, WebP, and PDF attachments are supported.'
  }
  if (kind === 'image' && file.size > MAX_CHAT_IMAGE_BYTES) {
    return 'Image is too large. Maximum size is 14 MB.'
  }
  if (kind === 'pdf' && file.size > MAX_CHAT_PDF_BYTES) {
    return 'PDF is too large. Maximum size is 32 MB.'
  }
  return null
}
