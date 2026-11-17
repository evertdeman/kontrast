# TODO

Internal notes on known gaps and planned improvements. Not user-facing.

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
