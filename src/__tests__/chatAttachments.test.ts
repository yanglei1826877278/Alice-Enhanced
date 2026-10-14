import { describe, expect, it } from 'vitest'
import {
  getChatAttachmentKind,
  getChatImageMimeType,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_PDF_BYTES,
  validateChatAttachment,
} from '../utils/chatAttachments'

const file = (name: string, type: string, size = 1) => ({ name, type, size })

describe('chat attachment validation', () => {
  it('caps a chat turn at a small multi-attachment batch', () => {
    expect(MAX_CHAT_ATTACHMENTS).toBe(6)
  })

  it('recognizes supported images by MIME type or extension', () => {
    expect(getChatAttachmentKind(file('photo.bin', 'image/jpeg'))).toBe('image')
    expect(getChatAttachmentKind(file('photo.WEBP', ''))).toBe('image')
    expect(getChatImageMimeType(file('photo.JPG', ''))).toBe('image/jpeg')
  })

  it('recognizes PDF files', () => {
    expect(getChatAttachmentKind(file('notes.pdf', ''))).toBe('pdf')
    expect(getChatAttachmentKind(file('notes.bin', 'application/pdf'))).toBe(
      'pdf'
    )
  })

  it('rejects unsupported and oversized files', () => {
    expect(
      validateChatAttachment(file('archive.zip', 'application/zip'))
    ).toMatch(/Only PNG/)
    expect(
      validateChatAttachment(
        file('large.png', 'image/png', MAX_CHAT_IMAGE_BYTES + 1)
      )
    ).toMatch(/14 MB/)
    expect(
      validateChatAttachment(
        file('large.pdf', 'application/pdf', MAX_CHAT_PDF_BYTES + 1)
      )
    ).toMatch(/32 MB/)
  })
})
