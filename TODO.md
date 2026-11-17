# TODO

Internal notes on scope, known gaps and planned improvements. Not user-facing.

## Scope & vision

Kontrast is not only an image viewer — it's a client-side DICOM workbench:

1. **Image viewer** (today) — render image series, windowing, measurement, etc.
2. **Header / metadata reader** (today, to deepen) — inspect the full DICOM
   header of any object, including private tags and nested sequences.
3. **Non-image object support** (future) — read and present the "funky" objects
   that are currently skipped, not just image IODs.

The guiding principle: **never silently drop a DICOM object.** If we can't fully
render it, we should still list it and let the user read its header.

## Non-image DICOM object support

Today [`parseTags`](src/lib/dicom/parse.ts) skips any file with no PixelData
(`noImage`) or an unsupported transfer syntax (`unsupported`). The goal is to
support these first-class instead:

- [ ] **Stop silently skipping non-image objects.** List them in the studies /
      series panel (by modality / SOP class) so they're visible and at minimum
      their header can be opened.
- [ ] **Full header reader for every object.** Make the complete tag tree
      browsable for *any* DICOM file — even ones we can't render — with VR,
      sequences / nested items, and private tags.
- [ ] **Structured Reports (SR).** Render the SR content tree: narrative text,
      coded content, measurements, and links to referenced images.
- [ ] **Encapsulated PDF.** Display the embedded PDF.
- [ ] **Presentation States (GSPS).** Apply to the referenced images (window,
      zoom/pan, annotations, shutters, flips).
- [ ] **Segmentation (SEG).** Overlay masks on the referenced series rather than
      showing raw mask frames.
- [ ] **RT Structure Set.** Render ROI contours over the referenced images.
- [ ] **Waveforms (e.g. ECG).** Plot waveform data.
- [ ] **DICOM video.** Play encapsulated MPEG / H.26x video (transfer syntaxes
      `…1.2.4.100`–`103` and friends), currently skipped as `unsupported`.

Note: SEG, RTDOSE and RTIMAGE carry pixel data, so they already load as raw
image frames today — but without their semantics (no overlay / dose mapping).

## Memory handling

The viewer is 100% client-side and keeps everything in the browser tab's
memory, with **no cap** on file count or total size. Raw files and parsed
metadata stay resident for the whole session; decoded pixels are bounded by
Cornerstone's image cache (default 3 GB, LRU-evicted). The practical ceiling is
the tab's memory. Safeguards worth adding:

- [ ] **Free memory on "Clear session".** `clearImageTags()` only clears the
      app's tag/file maps — it does **not** purge Cornerstone's image cache or
      `wadouri.fileManager`, so memory lingers until the tab is reloaded. Purge
      both on session clear.
- [ ] **Soft warning for large selections.** Warn before indexing when a
      selection exceeds a size / file-count threshold, so users aren't caught
      out by a slow load or a tab crash.
- [ ] **Size-aware image cache.** Derive Cornerstone's `maxCacheSize` from
      `navigator.deviceMemory` instead of the fixed 3 GB default, so low-RAM
      devices get a smaller cap and large machines can use more.

### Related spike points (for context)

- Indexing reads up to 6 files at once fully into memory (`CONCURRENCY = 6` in
  `loadDicom.ts`).
- Zips are fully decompressed into memory, including nested archives
  (`expandArchives` in `files.ts`).
- A single very large file is read into one `ArrayBuffer`, which can fail to
  allocate for multi-GB files.
