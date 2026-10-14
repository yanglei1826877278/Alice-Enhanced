import { BrowserWindow, ipcMain, screen } from 'electron'

export function registerWindowDragHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  let activeWindow: BrowserWindow | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    activeWindow?.removeListener('blur', stop)
    activeWindow?.removeListener('closed', stop)
    activeWindow?.webContents.removeListener('render-process-gone', stop)
    activeWindow = null
  }

  ipcMain.on('window:drag-start', event => {
    const window = getMainWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents)
      return
    stop()
    const cursor = screen.getCursorScreenPoint()
    const [x, y] = window.getPosition()
    activeWindow = window
    window.once('blur', stop)
    window.once('closed', stop)
    window.webContents.once('render-process-gone', stop)
    // Electron cursor and window positions both use DIP coordinates, including
    // on displays with different scale factors. Renderer screenX/Y may not.
    timer = setInterval(() => {
      if (window.isDestroyed()) {
        stop()
        return
      }
      const nextCursor = screen.getCursorScreenPoint()
      window.setPosition(
        x + nextCursor.x - cursor.x,
        y + nextCursor.y - cursor.y
      )
    }, 16)
    timer.unref()
  })

  ipcMain.on('window:drag-end', event => {
    if (event.sender === activeWindow?.webContents) stop()
  })
}
