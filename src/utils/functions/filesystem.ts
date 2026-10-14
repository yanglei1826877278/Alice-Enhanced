interface FunctionResult {
  success: boolean
  data?: any
  error?: string
}

export interface OpenPathArgs {
  target: string
}

export interface ListDirectoryArgs {
  path: string
}

export interface ExecuteCommandArgs {
  command: string
  cwd?: string
}

export interface ReadFileArgs {
  path: string
  maxChars?: number
}

export interface ViewImageArgs {
  path: string
}

export interface WebFetchArgs {
  url: string
  maxChars?: number
}

export interface ProcessArgs {
  action: 'start' | 'list' | 'poll' | 'output' | 'write' | 'stop'
  command?: string
  cwd?: string
  processId?: string
  cursor?: number
  input?: string
}

export interface DelegateTaskArgs {
  prompt: string
  cwd: string
  model?: string
  effort?: string
}

export interface ManageDelegatedTaskArgs {
  action: 'status' | 'result' | 'cancel'
  taskId: string
}

export interface WriteTextFileArgs {
  path: string
  content: string
  mode: 'create' | 'append' | 'overwrite'
}

export interface SearchFilesArgs {
  root: string
  pattern?: string
  query?: string
}

function requireDesktopAPI() {
  if (typeof window === 'undefined' || !window.desktopAPI) {
    throw new Error(
      'Electron desktop bridge not available. This function only works in the desktop app.'
    )
  }
  return window.desktopAPI
}

export async function open_path(args: OpenPathArgs): Promise<FunctionResult> {
  console.log(`Invoking open_path with target: ${args.target}`)

  try {
    if (typeof window === 'undefined' || !window.aliceIPC?.invoke) {
      return {
        success: false,
        error:
          'Electron IPC bridge not available. This function only works in the desktop app.',
      }
    }

    const result = await window.aliceIPC.invoke('electron:open-path', args)
    console.log('Main process response for open_path:', result)

    if (result.success) {
      return { success: true, data: { message: result.message } }
    } else {
      return { success: false, error: result.message }
    }
  } catch (error) {
    console.error('Error invoking electron:open-path:', error)
    return {
      success: false,
      error: `Failed to execute open_path: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

export async function list_directory(
  args: ListDirectoryArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().listDirectory(args.path)
    if (result.success) {
      return { success: true, data: result.files }
    } else {
      return { success: false, error: result.error }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function execute_command(
  args: ExecuteCommandArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().executeCommand(args)
    if (result.success) {
      return { success: true, data: result.output }
    } else {
      return { success: false, error: result.error }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function read_file(args: ReadFileArgs): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().readFile(args)
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function view_image(args: ViewImageArgs): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().viewImage(args)
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function web_fetch(args: WebFetchArgs): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().webFetch(args)
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function manage_process(
  args: ProcessArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().process(args)
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function delegate_task(
  args: DelegateTaskArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().delegateTask(args)
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function manage_delegated_task(
  args: ManageDelegatedTaskArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().manageDelegatedTask(args)
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function write_text_file(
  args: WriteTextFileArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().writeTextFile(args)
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function search_files(
  args: SearchFilesArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().searchFiles(args)
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
