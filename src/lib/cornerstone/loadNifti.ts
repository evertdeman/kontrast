/**
 * Show NIfTI volumes in the same stack viewport as DICOM, one image per slice.
 *
 * A file is indexed from its header alone. Its voxels are read the first time
 * one of its slices is shown, and every slice is a view into that one array.
 * All in memory: nothing leaves the device.
 */
import { Enums, metaData, registerImageLoader, utilities, type Types } from '@cornerstonejs/core'
import { SkipError, type DicomTags } from '@/lib/dicom/parse'
import {
  niftiLayout,
  readNiftiHeader,
  readNiftiPixels,
  slicePosition,
  type NiftiHeader,
  type NiftiLayout,
  type NiftiPixels,
} from '@/lib/nifti/volume'

export const NIFTI_FILE = /\.nii(\.gz)?$/i

interface NiftiVolume {
  file: File
  header: NiftiHeader
  layout: NiftiLayout
  /** Read on first use. */
  pixels?: Promise<NiftiPixels>
}

/** Volumes by id. Ids are never reused, as Cornerstone caches by imageId. */
const volumes = new Map<number, NiftiVolume>()
let nextId = 0

function parseImageId(imageId: string): { id: number; slice: number } | null {
  const match = /^nifti:(\d+)\/(\d+)$/.exec(imageId)
  return match ? { id: Number(match[1]), slice: Number(match[2]) } : null
}

function loadImage(imageId: string): Types.IImageLoadObject {
  const promise = (async (): Promise<Types.IImage> => {
    const parsed = parseImageId(imageId)
    const volume = parsed && volumes.get(parsed.id)
    if (!volume) throw new Error(`Unknown NIfTI image ${imageId}`)
    volume.pixels ??= readNiftiPixels(volume.file, volume.header, volume.layout)
    const pixels = await volume.pixels
    const { columns, rows, columnSpacing, rowSpacing } = volume.layout
    const length = columns * rows
    const data = pixels.data.subarray(parsed.slice * length, (parsed.slice + 1) * length)
    return {
      imageId,
      rows,
      columns,
      height: rows,
      width: columns,
      columnPixelSpacing: columnSpacing,
      rowPixelSpacing: rowSpacing,
      minPixelValue: pixels.min,
      maxPixelValue: pixels.max,
      windowCenter: pixels.windowCenter,
      windowWidth: pixels.windowWidth,
      voiLUTFunction: Enums.VOILUTFunctionType.LINEAR,
      slope: 1,
      intercept: 0,
      color: false,
      rgba: false,
      invert: false,
      numberOfComponents: 1,
      dataType: 'Float32Array',
      sizeInBytes: data.byteLength,
      getPixelData: () => data,
      getCanvas: () => {
        throw new Error('NIfTI images have no canvas')
      },
      voxelManager: utilities.VoxelManager.createImageVoxelManager({
        width: columns,
        height: rows,
        numberOfComponents: 1,
        scalarData: data,
      }),
    }
  })()
  return { promise }
}

function provideMetadata(type: string, imageId: string): unknown {
  const parsed = parseImageId(imageId)
  const layout = parsed && volumes.get(parsed.id)?.layout
  if (!layout) return undefined
  const { rows, columns, rowCosines, columnCosines, rowSpacing, columnSpacing } = layout
  switch (type) {
    case Enums.MetadataModules.IMAGE_PLANE:
      return {
        frameOfReferenceUID: `nifti-${parsed.id}`,
        rows,
        columns,
        rowCosines,
        columnCosines,
        imageOrientationPatient: [...rowCosines, ...columnCosines],
        imagePositionPatient: slicePosition(layout, parsed.slice),
        pixelSpacing: [rowSpacing, columnSpacing],
        rowPixelSpacing: rowSpacing,
        columnPixelSpacing: columnSpacing,
        sliceThickness: layout.sliceSpacing,
      }
    case Enums.MetadataModules.IMAGE_PIXEL:
      return {
        samplesPerPixel: 1,
        photometricInterpretation: 'MONOCHROME2',
        rows,
        columns,
        bitsAllocated: 32,
        bitsStored: 32,
        highBit: 31,
        pixelRepresentation: 1,
      }
    case Enums.MetadataModules.GENERAL_SERIES:
      return { modality: '' }
    default:
      return undefined
  }
}

let registered = false

/** Register the NIfTI image loader and metadata provider once, globally. */
export function registerNiftiImageLoader() {
  if (registered) return
  registerImageLoader('nifti', loadImage)
  metaData.addProvider(provideMetadata, 10_000)
  registered = true
}

const decimals = (values: number[]) => values.map((n) => String(Number(n.toFixed(4)))).join('\\')

/** A DICOM-style header for the whole file, like a multi-frame DICOM's. */
function fileTags(id: number, name: string, layout: NiftiLayout): DicomTags {
  const description = name.replace(NIFTI_FILE, '') || 'NIfTI volume'
  const seriesDescription = layout.volumes > 1 ? `Volume 1 of ${layout.volumes}` : 'Volume'
  const orientation = [...layout.rowCosines, ...layout.columnCosines]
  return {
    studyUID: `nifti-${id}`,
    seriesUID: `nifti-${id}`,
    sopUID: '',
    sopClassUID: '',
    modality: '',
    studyDescription: description,
    seriesDescription,
    studyDate: '',
    patientName: '',
    patientId: '',
    patientSex: '',
    seriesNumber: 1,
    instanceNumber: 1,
    rows: layout.rows,
    columns: layout.columns,
    numberOfFrames: layout.slices,
    imageOrientation: orientation,
    imagePosition: layout.origin,
    patientOrientation: null,
    accession: '',
    burnedInAnnotation: '',
    format: 'nifti',
    summary: {
      StudyDescription: description,
      SeriesDescription: seriesDescription,
      Rows: String(layout.rows),
      Columns: String(layout.columns),
      NumberOfFrames: String(layout.slices),
      PixelSpacing: decimals([layout.rowSpacing, layout.columnSpacing]),
      SpacingBetweenSlices: decimals([layout.sliceSpacing]),
      ImageOrientationPatient: decimals(orientation),
    },
  }
}

/**
 * Index a NIfTI file from its header: an imageId per slice and one header for
 * them all. Throws a SkipError if it isn't NIfTI we can show.
 */
export async function addNiftiFile(file: File): Promise<{ imageIds: string[]; tags: DicomTags }> {
  const header = await readNiftiHeader(file).catch(() => null)
  if (!header) throw new SkipError('notDicom')
  const layout = niftiLayout(header)
  const id = nextId++
  volumes.set(id, { file, header, layout })
  return {
    imageIds: Array.from({ length: layout.slices }, (_, k) => `nifti:${id}/${k}`),
    tags: fileTags(id, file.name, layout),
  }
}

/** Drop the volumes behind these images, with their voxels. */
export function releaseNiftiImages(imageIds: string[]) {
  for (const imageId of imageIds) {
    const parsed = parseImageId(imageId)
    if (parsed) volumes.delete(parsed.id)
  }
}

export function clearNiftiVolumes() {
  volumes.clear()
}
