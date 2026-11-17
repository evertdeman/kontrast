// dcmjs ships no type declarations; we only use its data dictionary.
declare module 'dcmjs' {
  interface DictionaryEntry {
    tag: string
    vr: string
    vm: string
    name: string
  }

  const dcmjs: {
    data: {
      DicomMetaDictionary: {
        /** Keyed by "(GGGG,EEEE)", upper-case hex. */
        dictionary: Record<string, DictionaryEntry | undefined>
        /** Keyed by keyword, e.g. "PatientName". */
        nameMap: Record<string, DictionaryEntry | undefined>
      }
    }
  }
  export default dcmjs
}
