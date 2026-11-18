"""Generate the bundled sample study: a synthetic CT head phantom.

Writes RLE-compressed DICOM files, zipped, to public/sample.zip. The data is
entirely synthetic (3D Shepp-Logan-style ellipsoids in Hounsfield units), so it
carries no patient information and no third-party licence.

    python scripts/generate_sample.py
"""

import tempfile
import zipfile
from pathlib import Path

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import (
    CTImageStorage,
    ExplicitVRLittleEndian,
    RLELossless,
    generate_uid,
)

OUT = Path(__file__).resolve().parent.parent / "public" / "sample.zip"
SIZE = 192  # isotropic volume, voxels per side
SLICES = 48  # slices per series
FOV_MM = 220.0

# (centre xyz, semi-axes xyz, rotation about z in degrees, HU added)
# Coordinates are in [-1, 1] across the volume.
ELLIPSOIDS = [
    ((0, 0, 0), (0.69, 0.92, 0.81), 0, 1000 + 800),  # skull (bone over air)
    ((0, -0.0184, 0), (0.6624, 0.874, 0.78), 0, -760),  # brain = 40 HU
    ((0.22, 0, 0), (0.11, 0.31, 0.22), -18, -40),  # right ventricle → CSF
    ((-0.22, 0, 0), (0.16, 0.41, 0.28), 18, -40),  # left ventricle → CSF
    ((0, 0.35, -0.15), (0.21, 0.25, 0.41), 0, 25),
    ((0, 0.1, 0.25), (0.046, 0.046, 0.05), 0, 30),  # small lesions
    ((-0.08, -0.605, 0), (0.046, 0.023, 0.05), 0, 30),
    ((0.06, -0.605, 0), (0.023, 0.046, 0.05), 0, 30),
    ((0, -0.1, 0.25), (0.046, 0.046, 0.05), 0, 30),
    ((0, -0.605, 0), (0.023, 0.023, 0.02), 0, 30),
]


def phantom(n: int) -> np.ndarray:
    axis = np.linspace(-1, 1, n, dtype=np.float32)
    z, y, x = np.meshgrid(axis, axis, axis, indexing="ij")
    vol = np.full((n, n, n), -1000.0, dtype=np.float32)
    for (cx, cy, cz), (a, b, c), angle, hu in ELLIPSOIDS:
        t = np.deg2rad(angle)
        xr = (x - cx) * np.cos(t) + (y - cy) * np.sin(t)
        yr = -(x - cx) * np.sin(t) + (y - cy) * np.cos(t)
        inside = (xr / a) ** 2 + (yr / b) ** 2 + ((z - cz) / c) ** 2 <= 1
        vol[inside] += hu
    return np.clip(vol, -1024, 3071)


def write_series(out, vol, study, series_number, description, plane, start_index):
    spacing = FOV_MM / SIZE
    series_uid = generate_uid(entropy_srcs=[study["uid"], description])
    picks = np.linspace(SIZE * 0.12, SIZE * 0.88, SLICES).astype(int)
    names = []

    for i, k in enumerate(picks):
        if plane == "axial":
            img = vol[k]
            orientation = [1, 0, 0, 0, 1, 0]
            position = [-FOV_MM / 2, -FOV_MM / 2, -FOV_MM / 2 + k * spacing]
        else:  # coronal, superior at the top
            img = vol[::-1, k, :]
            orientation = [1, 0, 0, 0, 0, -1]
            position = [-FOV_MM / 2, -FOV_MM / 2 + k * spacing, FOV_MM / 2]
        stored = (np.round(img) + 1024).astype(np.uint16)

        ds = Dataset()
        ds.file_meta = FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.file_meta.MediaStorageSOPClassUID = CTImageStorage
        sop_uid = generate_uid(entropy_srcs=[series_uid, str(i)])
        ds.file_meta.MediaStorageSOPInstanceUID = sop_uid

        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = sop_uid
        ds.PatientName = "Phantom^Lumen"
        ds.PatientID = "LUMEN-SAMPLE"
        ds.PatientSex = "O"
        ds.StudyInstanceUID = study["uid"]
        ds.StudyDescription = "Sample · synthetic head phantom"
        ds.StudyDate = "20250101"
        ds.StudyTime = "120000"
        ds.AccessionNumber = "SAMPLE"
        ds.StudyID = "1"
        ds.Manufacturer = "Lumen (synthetic)"
        ds.Modality = "CT"
        ds.BodyPartExamined = "HEAD"
        ds.SeriesInstanceUID = series_uid
        ds.SeriesNumber = series_number
        ds.SeriesDescription = description
        ds.InstanceNumber = i + 1
        ds.ImageType = ["DERIVED", "SECONDARY"]
        ds.FrameOfReferenceUID = study["for"]
        ds.ImagePositionPatient = [round(v, 3) for v in position]
        ds.ImageOrientationPatient = orientation
        ds.PixelSpacing = [round(spacing, 4)] * 2
        ds.SliceThickness = round(spacing, 4)
        ds.KVP = 120
        ds.ConvolutionKernel = "SYNTHETIC"
        ds.Rows, ds.Columns = stored.shape
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 0
        ds.RescaleIntercept = -1024
        ds.RescaleSlope = 1
        ds.RescaleType = "HU"
        ds.WindowCenter = 40
        ds.WindowWidth = 80

        ds.compress(RLELossless, stored)
        name = f"IM{start_index + i:04d}.dcm"
        ds.save_as(out / name, write_like_original=False)
        names.append(name)
    return names


def main():
    vol = phantom(SIZE)
    study = {
        "uid": generate_uid(entropy_srcs=["lumen-sample-study"]),
        "for": generate_uid(entropy_srcs=["lumen-sample-for"]),
    }
    # One zip loads in a single request; the app unpacks it like any other zip.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        files = write_series(out, vol, study, 1, "Axial", "axial", 0)
        files += write_series(out, vol, study, 2, "Coronal", "coronal", len(files))
        with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
            for name in files:
                zf.write(out / name, f"sample/{name}")
    print(f"Wrote {len(files)} files ({OUT.stat().st_size / 1e6:.1f} MB zipped) to {OUT}")


if __name__ == "__main__":
    main()
