#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import https from 'https'
import { createHash } from 'crypto'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configuration
const MODEL_NAME = 'intfloat/multilingual-e5-small'
const MODEL_REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
const BACKEND_DIR = path.join(__dirname, '..', 'backend')
const MODELS_DIR = path.join(BACKEND_DIR, 'models')

// Utility functions
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`Created directory: ${dir}`)
  }
}

function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects while downloading ${url}`))
      return
    }
    console.log(`Downloading ${url}...`)
    https
      .get(url, response => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          response.resume()
          if (!response.headers.location) {
            reject(new Error('Download redirect did not include a location.'))
            return
          }
          return downloadFile(response.headers.location, dest, redirects + 1)
            .then(resolve)
            .catch(reject)
        }

        if (response.statusCode !== 200) {
          reject(
            new Error(`Download failed with status: ${response.statusCode}`)
          )
          response.resume()
          return
        }

        const file = fs.createWriteStream(dest)
        response.pipe(file)

        file.on('finish', () => {
          file.close()
          console.log(`Downloaded: ${dest}`)
          resolve()
        })

        file.on('error', err => {
          response.destroy()
          fs.rm(dest, { force: true }, () => {})
          reject(err)
        })
      })
      .on('error', error => {
        fs.rm(dest, { force: true }, () => {})
        reject(error)
      })
  })
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function downloadModel({ tokenizerOnly = false } = {}) {
  console.log('\\nSetting up multilingual E5 model...')

  ensureDir(MODELS_DIR)
  const modelDir = path.join(MODELS_DIR, 'minilm')
  ensureDir(modelDir)

  const baseUrl = `https://huggingface.co/${MODEL_NAME}/resolve/${MODEL_REVISION}/onnx`
  const artifacts = [
    {
      name: 'multilingual-e5-small.onnx',
      url: `${baseUrl}/model_O4.onnx`,
      sha256:
        '4654c156f3e4171abc9c716cdb771bf9116455d15ac1aab364aeeede0e3205b0',
    },
    {
      name: 'multilingual-e5-small-tokenizer.json',
      url: `${baseUrl}/tokenizer.json`,
      sha256:
        '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
    },
  ]

  const selectedArtifacts = tokenizerOnly
    ? artifacts.filter(artifact => artifact.name.includes('tokenizer'))
    : artifacts

  for (const artifact of selectedArtifacts) {
    const destination = path.join(modelDir, artifact.name)
    if (fs.existsSync(destination)) {
      const existingDigest = await sha256File(destination)
      if (existingDigest === artifact.sha256) {
        console.log(`Keeping existing embedding artifact: ${destination}`)
        continue
      }
      console.warn(`Replacing invalid embedding artifact: ${destination}`)
      fs.rmSync(destination, { force: true })
    }
    await downloadFile(artifact.url, destination)
    const digest = await sha256File(destination)
    if (digest !== artifact.sha256) {
      fs.rmSync(destination, { force: true })
      throw new Error(`Checksum mismatch for ${artifact.name}`)
    }
  }
}

async function main() {
  console.log('Setting up embeddings dependencies...')

  try {
    const tokenizerOnly = process.argv.includes('--tokenizer-only')
    await downloadModel({ tokenizerOnly })

    console.log('\\n✅ Embeddings setup completed!')
    console.log('\\nNext steps:')
    console.log(
      '1. Build the Go backend with the pinned multilingual artifacts'
    )
    console.log('2. Verify electron-builder includes backend/models')
    console.log('3. Run the backend and test Memory/RAG retrieval')
  } catch (error) {
    console.error('\\n❌ Setup failed:', error.message)
    process.exit(1)
  }
}

// Run if this is the main module
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
