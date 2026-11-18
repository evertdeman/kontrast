"""Generate the bundled sample study: a simulated brain MRI (T1 + FLAIR).

The anatomy comes from the ICBM152 2009 nonlinear-symmetric template, an
*averaged* brain built from 152 subjects -- not a real, identifiable patient.
From its grey-matter, white-matter and CSF probability maps this script
synthesises two co-registered axial series with realistic contrast:

  * Axial T1    -- the averaged T1-weighted template itself.
  * Axial FLAIR -- synthesised contrast (CSF suppressed/dark, grey matter a
                   little brighter than white matter).

Rician noise and a smooth bias field are added so the result reads like a
single acquisition rather than a smooth average. Output is RLE-compressed
DICOM, zipped to public/sample.zip.

The ICBM152 template is used under its permissive licence (see the copyright
notice in COPYRIGHT below), which allows use, modification and redistribution
for any purpose provided the notice is retained; it is therefore embedded in
every generated file (DerivationDescription) and credited in the README.

    # download+unzip mni_icbm152_nlin_sym_09a_nifti.zip from
    #   https://nist.mni.mcgill.ca/icbm-152-nonlinear-atlases-2009/
    python scripts/generate_sample.py path/to/mni_icbm152_nlin_sym_09a

Requires: numpy, scipy, pydicom, nibabel.
"""

import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import nibabel as nib
from scipy.ndimage import gaussian_filter
from openjpeg import encode as j2k_encode
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.encaps import encapsulate
from pydicom.uid import (
    MRImageStorage,
    JPEG2000Lossless,
    generate_uid,
)

OUT = Path(__file__).resolve().parent.parent / "public" / "sample.zip"
SLICE_MM = 4.0  # axial slice spacing of the output series
MARGIN = 10  # voxels of head kept around the brain, in plane

COPYRIGHT = (
    "Copyright (C) 1993-2004 Louis Collins, McConnell Brain Imaging Centre, "
    "Montreal Neurological Institute, McGill University. Permission to use, "
    "copy, modify, and distribute this software and its documentation for any "
    "purpose and without fee is hereby granted, provided that the above "
    "copyright notice appear in all copies."
)
DERIVATION = (
    "Simulated brain MRI. Anatomy derived from the ICBM152 2009 nonlinear "
    "symmetric template (an average of 152 subjects, not a real patient); "
    "T1 and FLAIR contrast synthesised by Kontrast. " + COPYRIGHT
)


def load(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Load a NIfTI reoriented to (L, P, S) voxel axes; return data and its
    voxel->RAS affine."""
    img = nib.load(str(path))
    src = nib.orientations.io_orientation(img.affine)
    tgt = nib.orientations.axcodes2ornt(("L", "P", "S"))
    t = nib.orientations.ornt_transform(src, tgt)
    data = nib.orientations.apply_orientation(
        np.asanyarray(img.dataobj).astype(np.float32), t
    )
    affine = img.affine @ nib.orientations.inv_ornt_aff(t, img.shape)
    return data, affine


def finish(vol: np.ndarray, seed: int, noise: float, bias: float) -> np.ndarray:
    """Add a smooth multiplicative bias field and Rician noise."""
    rng = np.random.default_rng(seed)
    b = gaussian_filter(rng.standard_normal(vol.shape).astype(np.float32), 18)
    b = 1 + bias * (b / (np.abs(b).max() + 1e-6))
    v = vol * b
    n1 = rng.normal(0, noise, vol.shape)
    n2 = rng.normal(0, noise, vol.shape)
    return np.sqrt(np.clip(v + n1, 0, None) ** 2 + n2**2)


def synthesize(atlas: Path):
    t1, affine = load(atlas / "mni_icbm152_t1_tal_nlin_sym_09a.nii")
    gm, _ = load(atlas / "mni_icbm152_gm_tal_nlin_sym_09a.nii")
    wm, _ = load(atlas / "mni_icbm152_wm_tal_nlin_sym_09a.nii")
    csf, _ = load(atlas / "mni_icbm152_csf_tal_nlin_sym_09a.nii")
    mask, _ = load(atlas / "mni_icbm152_t1_tal_nlin_sym_09a_mask.nii")

    t1n = np.clip(t1 / np.percentile(t1[t1 > 1], 99.5), 0, 1.2)

    # FLAIR: dark CSF, grey matter a touch brighter than white; outside the
    # brain borrow the head outline (scalp/fat bright, bone dark) from the T1.
    tissue = gm + wm + csf + 1e-6
    fl_brain = (0.60 * wm + 0.80 * gm + 0.05 * csf) / tissue
    brain = gaussian_filter(np.clip(mask, 0, 1), 1.0)
    fl = np.clip(brain * fl_brain + (1 - brain) * (t1n * 0.85), 0, 1.2)

    t1_vol = finish(t1n, 1, noise=0.010, bias=0.06)
    fl_vol = finish(fl, 2, noise=0.014, bias=0.08)

    # Crop in plane to the head bounding box (+margin) to trim black borders.
    head = gaussian_filter(np.clip(mask, 0, 1) + (t1n > 0.08), 1.0) > 0.3
    xs = np.where(head.any(axis=(1, 2)))[0]
    ys = np.where(head.any(axis=(0, 2)))[0]
    zs = np.where(np.clip(mask, 0, 1).any(axis=(0, 1)))[0]
    x0, x1 = max(xs[0] - MARGIN, 0), min(xs[-1] + MARGIN + 1, t1.shape[0])
    y0, y1 = max(ys[0] - MARGIN, 0), min(ys[-1] + MARGIN + 1, t1.shape[1])
    z0, z1 = zs[0], zs[-1] + 1

    sl = (slice(x0, x1), slice(y0, y1))
    return {
        "t1": t1_vol[sl],
        "fl": fl_vol[sl],
        "affine": affine,
        "origin_vox": (x0, y0),  # (i, j) of cropped [0,0] at full-volume k
        "z": (z0, z1),
    }


# RAS -> LPS (DICOM patient coordinates)
R2L = np.diag([-1.0, -1.0, 1.0, 1.0])


def write_series(out, data, vol, study, number, description, seq, start, picks):
    affine = data["affine"]
    vox2lps = R2L @ affine
    ox, oy = data["origin_vox"]
    # Array for a slice is vol[:, :, k].T -> rows index +j (P), cols index +i (L)
    row_dir = vox2lps[:3, 1] / np.linalg.norm(vox2lps[:3, 1])  # increasing row
    col_dir = vox2lps[:3, 0] / np.linalg.norm(vox2lps[:3, 0])  # increasing col
    iop = [*col_dir, *row_dir]  # DICOM: [row-of-first-row, col-of-first-col]
    px = round(float(np.linalg.norm(vox2lps[:3, 0])), 4)  # mm per column step
    py = round(float(np.linalg.norm(vox2lps[:3, 1])), 4)  # mm per row step

    series_uid = generate_uid(entropy_srcs=[study["uid"], description])
    names = []
    for i, k in enumerate(picks):
        img = vol["t1" if description.endswith("T1") else "fl"][:, :, k].T
        hi = np.percentile(img, 99.5)
        stored = np.clip(np.round(img / hi * 1000.0), 0, 2000).astype(np.uint16)
        ipp = (vox2lps @ np.array([ox, oy, k, 1.0]))[:3]

        ds = Dataset()
        ds.file_meta = FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = JPEG2000Lossless
        ds.file_meta.MediaStorageSOPClassUID = MRImageStorage
        sop_uid = generate_uid(entropy_srcs=[series_uid, str(i)])
        ds.file_meta.MediaStorageSOPInstanceUID = sop_uid

        ds.SOPClassUID = MRImageStorage
        ds.SOPInstanceUID = sop_uid
        ds.PatientName = "Kontrast^Sample"
        ds.PatientID = "KONTRAST-SAMPLE"
        ds.PatientSex = "O"
        ds.StudyInstanceUID = study["uid"]
        ds.StudyDescription = "Sample · simulated brain MRI"
        ds.StudyDate = "20250101"
        ds.StudyTime = "120000"
        ds.AccessionNumber = "SAMPLE"
        ds.StudyID = "1"
        ds.Manufacturer = "Kontrast (simulated)"
        ds.Modality = "MR"
        ds.BodyPartExamined = "BRAIN"
        ds.MagneticFieldStrength = 3
        ds.ScanningSequence = seq["ScanningSequence"]
        ds.SequenceVariant = seq["SequenceVariant"]
        ds.RepetitionTime = seq["RepetitionTime"]
        ds.EchoTime = seq["EchoTime"]
        if "InversionTime" in seq:
            ds.InversionTime = seq["InversionTime"]
        ds.SeriesInstanceUID = series_uid
        ds.SeriesNumber = number
        ds.SeriesDescription = description
        ds.ProtocolName = description
        ds.InstanceNumber = i + 1
        ds.ImageType = ["DERIVED", "SECONDARY"]
        ds.DerivationDescription = DERIVATION
        ds.FrameOfReferenceUID = study["for"]
        ds.ImagePositionPatient = [round(float(v), 3) for v in ipp]
        ds.ImageOrientationPatient = [round(float(v), 6) for v in iop]
        ds.PixelSpacing = [py, px]
        ds.SliceThickness = SLICE_MM
        ds.SpacingBetweenSlices = SLICE_MM
        ds.Rows, ds.Columns = stored.shape
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 0
        ds.WindowCenter = 500
        ds.WindowWidth = 900

        # JPEG 2000 lossless (encoded directly; encapsulated into the dataset).
        frame = j2k_encode(np.ascontiguousarray(stored), bits_stored=12, use_mct=False)
        ds.PixelData = encapsulate([frame])
        ds["PixelData"].is_undefined_length = True
        name = f"IM{start + i:04d}.dcm"
        ds.save_as(out / name, write_like_original=False)
        names.append(name)
    return names


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python scripts/generate_sample.py path/to/mni_icbm152_nlin_sym_09a")
    atlas = Path(sys.argv[1])
    data = synthesize(atlas)

    z0, z1 = data["z"]
    affine = data["affine"]
    dz = abs(float(affine[2, 2]))  # mm per slice-index step
    step = max(int(round(SLICE_MM / dz)), 1)
    picks = list(range(z0, z1, step))

    study = {
        "uid": generate_uid(entropy_srcs=["kontrast-sample-study"]),
        "for": generate_uid(entropy_srcs=["kontrast-sample-for"]),
    }
    t1_seq = {
        "ScanningSequence": "SE",
        "SequenceVariant": "SP",
        "RepetitionTime": 500,
        "EchoTime": 10,
    }
    fl_seq = {
        "ScanningSequence": "SE",
        "SequenceVariant": "SK",
        "RepetitionTime": 9000,
        "EchoTime": 90,
        "InversionTime": 2500,
    }

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        files = write_series(out, data, data, study, 1, "Axial T1", t1_seq, 0, picks)
        files += write_series(
            out, data, data, study, 2, "Axial FLAIR", fl_seq, len(files), picks
        )
        with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
            for name in files:
                zf.write(out / name, f"sample/{name}")
    print(
        f"Wrote {len(files)} files ({len(picks)}/series, "
        f"{OUT.stat().st_size / 1e6:.1f} MB zipped) to {OUT}"
    )


if __name__ == "__main__":
    main()
