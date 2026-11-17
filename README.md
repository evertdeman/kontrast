# Kontrast

**Open any scan. Nothing leaves your device.**

Kontrast is a DICOM viewer that runs entirely in your browser. Drop in a folder, a few files or a zip from a hospital CD or PACS export, then scroll through the series, adjust brightness and contrast, and search every header tag. There is no server and no upload: your files never leave your computer.

<!-- TODO: add a screenshot of the bundled sample study, e.g. docs/screenshot.png -->

> [!IMPORTANT]
> **Kontrast is not a medical device.** It is a tool for opening and inspecting DICOM files for general, non-clinical purposes such as learning, curiosity and software development. Do not use it for diagnosis, treatment or any other medical decision. It is provided as is, without warranty.

## Features

**Opening files**

- Folders, individual files and `.zip` archives (including zips inside zips), by drag and drop or file picker
- CD and PACS exports: files with no extension, files named by UID, `DICOMDIR` folders
- Multi-frame files such as ultrasound clips and enhanced CT/MR, one image per frame
- Common compressions: JPEG baseline and lossless, JPEG-LS, JPEG 2000, HTJ2K, JPEG XL, RLE and deflate
- A clear summary of anything skipped and why (not DICOM, no image, unsupported compression such as video, damaged zip)

**Viewing**

- Studies and series grouped automatically, with slices ordered by their position in the body
- Scroll through slices or play a series as a cine loop
- Window/level (brightness and contrast), invert, zoom, pan, reset and simple length measurements
- Orientation markers (head/feet, left/right, front/back) derived from the image geometry, including X-rays
- Save the current view as a PNG
- Light and dark themes

**Inspecting**

- A header panel with the key patient, study, series and image fields; collapsible and resizable
- The full header, including nested sequences and private tags, with search across tags, keywords and values

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `W` | Window/level tool |
| `P` | Pan tool |
| `Z` | Zoom tool |
| `S` | Scroll tool |
| `L` | Length tool |
| `I` | Invert |
| `R` | Reset view |
| `↑` `↓` | Previous / next slice |
| `Space` | Play / pause cine |
| `H` | Full header |
| `T` | Show / hide the header panel |

With the mouse, the left button uses the selected tool, the right button zooms, the middle button pans and the wheel scrolls through slices.

## Privacy

Everything happens in your browser:

- Files are read with the browser's File API and kept in memory only. They are gone when you close or reload the tab.
- Nothing is uploaded, and there are no analytics, cookies or third-party requests. Fonts and decoders are bundled with the app.
- The only thing stored is your display preferences (theme and header panel layout), in your browser's local storage.

## Running it locally

Requirements: [Node.js](https://nodejs.org/) 22.12 or later and [pnpm](https://pnpm.io/) 12.

```bash
pnpm install
pnpm dev        # start the development server
```

Then open the URL it prints, usually <http://localhost:5173>. No scan to hand? Choose **Open a sample study** on the start page.

Other commands:

```bash
pnpm build      # type-check and build a static site into dist/
pnpm preview    # serve the production build locally
pnpm test       # unit tests (Vitest)
pnpm typecheck  # TypeScript only
pnpm lint       # oxlint
```

The production build is a static site, so it can be served from any static host.

### Sample study

The sample study in `public/sample/` is a synthetic CT head phantom made of simple shapes. It contains no patient data. To regenerate it you need Python with `numpy` and `pydicom`:

```bash
python scripts/generate_sample.py
```

### Test files (optional)

For manual testing against a wide range of real-world DICOM variants, you can fetch the [pydicom](https://github.com/pydicom/pydicom) test files into `test-data/`, which is ignored by git:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/pydicom/pydicom.git test-data/pydicom-repo
git -C test-data/pydicom-repo sparse-checkout set src/pydicom/data/test_files
git clone --depth 1 https://github.com/pydicom/pydicom-data.git test-data/pydicom-data-repo
```

## Built with

- [Cornerstone3D](https://www.cornerstonejs.org/) for rendering and image decoding
- [dicom-parser](https://github.com/cornerstonejs/dicomParser) and [dcmjs](https://github.com/dcmjs-org/dcmjs) for reading headers
- [fflate](https://github.com/101arrowz/fflate) for unpacking zips
- React, TypeScript and Vite
- Tailwind CSS, [shadcn/ui](https://ui.shadcn.com/) and [Radix](https://www.radix-ui.com/)
- Vitest for unit tests

## Project layout

```text
src/
  components/         UI: landing page, studies list, viewer
    viewer/           toolbar, viewport, series rail, header panel
  lib/
    cornerstone/      Cornerstone setup, image registration, study grouping
    dicom/            pure DICOM logic: parsing, header formatting, geometry
    files.ts          file pickers, drag and drop, zip unpacking
  test/               test helpers (an in-memory DICOM writer)
scripts/              sample study generator
public/sample/        bundled synthetic sample study
```

## Releases

Versioning follows [Semantic Versioning](https://semver.org/) and is automated with [semantic-release](https://semantic-release.org/). On every push to `main`, the release workflow derives the next version from the [Conventional Commits](https://www.conventionalcommits.org/) made since the last release, updates `CHANGELOG.md` and `package.json`, tags the commit and publishes a GitHub Release. Commit messages therefore drive the version:

- `fix: …` → patch release (`0.0.x`)
- `feat: …` → minor release (`0.x.0`)
- `feat!: …`, or any commit with a `BREAKING CHANGE:` footer → major release (`x.0.0`)

Other types (`chore:`, `docs:`, `ci:`, `refactor:`, `test:`, …) are recorded but do not trigger a release on their own.

## Status

Kontrast is in early development. Expect rough edges.

## Contributing

Bug reports and ideas are very welcome: please open an issue if a file does not open or displays incorrectly, or if something could work better. Describe the file (modality, where it came from, transfer syntax) but **never attach real patient data**.

Code contributions are not accepted at the moment: all code is written by the author, which keeps the licensing simple. Please do not open pull requests with code changes.

## Licence

Kontrast is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE).

In plain words: you may use, copy, modify and share it for any **non-commercial** purpose, such as personal use, study, research, teaching, or use by charities and public institutions. **Commercial use requires a separate licence from the author.** This summary is for convenience only; the [licence text](LICENSE) is what applies.

Third-party libraries are used under their own licences.
