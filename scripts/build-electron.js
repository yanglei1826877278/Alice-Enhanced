#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const cacheDir = path.join(
  projectRoot,
  'node_modules',
  '.cache',
  'electron-builder'
)
const electronBuilderCli = path.join(
  projectRoot,
  'node_modules',
  'electron-builder',
  'cli.js'
)

fs.mkdirSync(cacheDir, { recursive: true })

const builderArgs = [...process.argv.slice(2)]
const localElectronDist = path.join(projectRoot, 'node_modules', 'electron', 'dist')
if (fs.existsSync(localElectronDist)) {
  builderArgs.push(`--config.electronDist=${localElectronDist}`)
}

const result = spawnSync(
  process.execPath,
  [electronBuilderCli, ...builderArgs],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || cacheDir,
    },
    stdio: 'inherit',
  }
)

if (result.error) {
  console.error('Failed to start electron-builder:', result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
