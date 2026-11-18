// dcmjs ships no type declarations; these cover the parts we use.
declare module 'dcmjs' {
  interface DictionaryEntry {
    tag: string
    vr: string
    vm: string
    name: string
  }

  /** One element of a dataset, keyed by "GGGGEEEE" upper-case hex in its parent. */
  interface DicomElement {
    vr: string
    Value?: unknown[]
    /** The value as read, written back unchanged if `Value` was not modified. */
    _rawValue?: unknown
  }

  type DicomDataset = Record<string, DicomElement>

  class DicomDict {
    constructor(meta: DicomDataset)
    meta: DicomDataset
    dict: DicomDataset
    write(options?: { allowInvalidVRLength?: boolean }): ArrayBuffer
  }

  const dcmjs: {
    data: {
      DicomDict: typeof DicomDict
      DicomMessage: {
        readFile(buffer: ArrayBuffer, options?: { ignoreErrors?: boolean }): DicomDict
      }
      DicomMetaDictionary: {
        /** Keyed by "(GGGG,EEEE)", upper-case hex. */
        dictionary: Record<string, DictionaryEntry | undefined>
        /** Keyed by keyword, e.g. "PatientName". */
        nameMap: Record<string, DictionaryEntry | undefined>
      }
    }
  }
  export default dcmjs
  export type { DicomDataset, DicomDict, DicomElement }
}
