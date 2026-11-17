/**
 * One-time Cornerstone3D initialisation.
 *
 * This runs entirely in the browser. Nothing here (or anywhere in this app)
 * uploads DICOM data — pixel data stays on the user's device.
 */
import { init as coreInit } from '@cornerstonejs/core'
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader'
import {
  init as toolsInit,
  addTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  LengthTool,
} from '@cornerstonejs/tools'

let initialized = false
let initPromise: Promise<void> | null = null

async function run(): Promise<void> {
  await coreInit()
  toolsInit()
  dicomImageLoaderInit({
    maxWebWorkers: Math.max(1, Math.min(navigator.hardwareConcurrency ?? 1, 7)),
  })

  // Register the tools we use once, globally.
  addTool(WindowLevelTool)
  addTool(PanTool)
  addTool(ZoomTool)
  addTool(StackScrollTool)
  addTool(LengthTool)

  initialized = true
}

/** Idempotent: safe to call from multiple components / effects. */
export function initCornerstone(): Promise<void> {
  if (initialized) return Promise.resolve()
  if (!initPromise) initPromise = run()
  return initPromise
}
