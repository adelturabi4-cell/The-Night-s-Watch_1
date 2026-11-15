# Dataset Audit

## Scope and method

This audit covers the files supplied in
`C:\Users\asus\Desktop\MarsPath_AI_Resources (2)\MarsPath_AI_Resources` and
the scientific-data components already present in the MARTIAN MAP workspace.
The supplied directory contains 11 files totaling 241,959,568 bytes
(approximately 230.75 MiB). Original data was read-only during this audit;
no files were moved, rewritten, or cleaned.

Raster metadata was inspected with Rasterio where supported. The MOLA IMG was
read as a PDS3 fixed-size, big-endian signed 16-bit array using the dimensions
and encoding in its accompanying label. The JP2 statistics below are
descriptive of the available quicklook, not calibrated reflectance.

## Dataset inventory

| Dataset / files | Format and dimensions | Description and units | Provenance / notes |
|---|---|---|---|
| `Data/Terrain/MOLA/megt90n000eb.img` with `.lbl` and `.xml` | PDS3 IMG; 2,880 rows × 5,760 columns; 16,588,800 cells; 16-bit signed big-endian; 33,177,600-byte raster | Median topography in metres relative to the MOLA areoid product definition | Label identifies MGS MOLA MEGDR `MGS-M-MOLA-5-MEGDR-L3-V1.0`, product version 2.0. Global simple-cylindrical grid, 0.0625° per cell, planetocentric coordinates, east-positive longitude, 0–360°. The XML is supplementary metadata. |
| `Data/Imagery/HiRISE/ESP_052869_1660_RED.QLOOK.JP2` | JPEG 2000; 31,232 × 26,664; one `uint8` band; 832,770,048 pixels; 208,712,827 bytes | Quicklook pixel intensity; not a hazard class or calibrated physical measurement | MRO HiRISE observation `ESP_052869_1660`, taken 2017-11-06. Its label describes a rock-sheet to sand-sheet transition and a 0.25 m/pixel projected source product. The quicklook has no embedded CRS, affine transform, or nodata value in Rasterio; its accompanying PDS label is needed to reconstruct the map projection. |
| `Data/Imagery/HiRISE/ESP_052869_1660_RED.LBL` | PDS3 label; metadata, not image samples | Observation, projection, acquisition and source-product metadata | Describes the full 16-bit source image and its calibration metadata. The available QLOOK is a distinct 8-bit file variant; do not assume the source-product scaling/offset applies to its quicklook pixels. The full source image is not included. |
| `Data/Imagery/HiRISE/ESP_011485_1555_RED.LBL` and `ESP_011485_1555_RED (1).LBL` | PDS3 labels | Metadata for a rugged crater-floor observation | The two files have identical SHA-256 hashes and are confirmed duplicates. The large image product described by the labels is not included. |
| `Data/Imagery/HiRISE/ESP_049009_1520_RED.LBL` | PDS3 label | Metadata for a scene describing layers overlain by dark dunes | The large image product described by the label is not included. |
| `Data/Imagery/HiRISE/ESP_075450_1330_RED.LBL` | PDS3 label | Metadata for a crater observation | The large image product described by the label is not included. |
| `# MarsPath – Project Requirements.md` | Markdown document | Application goals and module requirements | Requirements document, not a scientific dataset. |
| `# MarsPath – Scientific Data Source.md` | Markdown document | Intended MOLA, HiRISE, MCD, THEMIS and PDS sources | Source guidance, not a scientific dataset. MCD and THEMIS data files are not present in the supplied directory. |

### HiRISE label footprints

The four distinct observation labels describe geographically separate scenes.
Coordinates below are the label's latitude/longitude bounds in degrees; east
longitudes greater than 180° need normalization if an application expects
−180° to 180°.

| Observation | Latitude range | East longitude range | Observation time | Local image included? |
|---|---:|---:|---|---|
| ESP_011485_1555 | −24.6476 to −24.1857 | 80.8848 to 81.0444 | 2009-01-07 | No |
| ESP_049009_1520 | −27.8906 to −27.7025 | 203.1120 to 203.2311 | 2017-01-09 | No |
| ESP_052869_1660 | −14.0876 to −13.9559 | 296.6168 to 296.7310 | 2017-11-06 | Yes, QLOOK JP2 |
| ESP_075450_1330 | −46.9018 to −46.7652 | 216.1237 to 216.2611 | 2022-08-31 | No |

Projection offsets and the PDS map-projection fields must be interpreted
together. `CENTER_LONGITUDE` is a projection parameter and must not be treated
as the scene's geographic center.

## Dimensions, values, missing data and quality

### MOLA

- The raw file size exactly matches 2,880 × 5,760 × 2 bytes. Reading it with
  the label's signed, big-endian encoding gives a minimum of −8,177 m, maximum
  of 21,171 m, mean of approximately −721.11 m, and standard deviation of
  approximately 2,976.96 m. The extrema agree with the label's stated product
  range.
- No separate nodata mask is provided in the supplied label/data, and all
  decoded values fall within the label's documented range. This does **not**
  mean every value is a direct observation: the label states that bins with
  no MOLA shots are interpolated. The supplied grid does not expose a flag
  distinguishing observed from interpolated cells.
- The label says the global product aggregates observations from the MGS
  primary and extended mission and describes the areoid/topography reference.
  Treat these as gridded product values, not point-level raw altimeter shots.

### HiRISE quicklook

- Rasterio recognizes one 8-bit band at 31,232 × 26,664 but reports no CRS,
  geotransform, or nodata value in the JP2 itself. The PDS label is therefore
  essential for locating pixels.
- In inspected overview data, intensities span 0–255. Sampled corner windows
  were all zero while a sampled central window contained nonzero values.
  Zero could represent image fill or a dark image value; do not convert it to
  missing data without validating the QLOOK encoding and mask convention.
- The PDS label describes a 16-bit source product, while the supplied QLOOK
  decodes as 8-bit. The source product's I/F scaling and offset must not be
  blindly applied to the QLOOK.
- The 052869 label describes a full source product with a 1.67 GB pixel
  payload, while the available QLOOK is a different 208.7 MB, 8-bit file
  variant. Labels for the other observations describe large image products
  that are not present; labels are not substitutes for those image rasters.

### Duplicates, coordinates and outliers

- The two `ESP_011485_1555_RED` labels are byte-for-byte identical (same
  SHA-256); one is redundant metadata. No other duplicate file was confirmed.
- MOLA latitude/longitude coverage and HiRISE label coordinates are within
  valid Mars coordinate ranges. MOLA uses east-positive 0–360° longitude;
  HiRISE labels use the same positive direction, so conversion is needed only
  at interfaces using a signed-longitude convention.
- No impossible MOLA elevation values were detected relative to the product
  label. No scientifically defensible outlier threshold can be inferred for
  the quicklook intensities without a validated mask, calibration, and image
  context.
- There are no tabular records, named feature columns, timestamps per raster
  cell, or annotated class labels in this collection. The raster cells are
  spatial samples, not independent training records.

### Example lookup for the location visible in the application

The open Location Intelligence page showed 87.957° N, 4.270° W. I looked up
that coordinate directly in the supplied higher-resolution MOLA file, using
the PDS simple-cylindrical grid definition and east-positive longitude:

- Nearest grid cell: row 33, sample 5,692 in the PDS one-based convention
  (zero-based array index `[32, 5691]`).
- Grid-cell center: 87.96875° N, 4.28125° W.
- Elevation: **−2,609 m** relative to the MOLA areoid reference.
- A 5 × 5-cell neighborhood ranges from −2,684 m to −2,524 m, with a mean
  of −2,613.16 m. This is a coarse regional context, not a local landing
  elevation or a safety assessment.

At this latitude a 0.0625° cell is approximately 3.70 km north-south and
0.13 km east-west. The east-west width shrinks toward the pole. These
dimensions refer to the supplied 1/16° grid; the application page describes
its regional MOLA coverage as 0.25° cells, so this lookup is **not evidence
that the supplied higher-resolution file has been integrated into the app**.

## Feature descriptions and target availability

| Candidate feature | Data type / units | Availability and caveats |
|---|---|---|
| MOLA topography | Signed integer, metres | Available globally at 0.0625°; coarse gridded topography and some bins are interpolated. |
| HiRISE quicklook intensity | Unsigned 8-bit pixel value | Available for one scene only. It is not a calibrated reflectance feature until the QLOOK processing and calibration are verified. |
| Latitude, longitude, projection coordinates | Degrees / projection units from PDS labels | Metadata only; a correct transform must be reconstructed from the PDS projection fields. |
| Slope, local elevation variation, roughness | Derived values, with units determined by the documented formula | Could be computed from an elevation grid after correcting for the planetary coordinate scale and handling missing/interpolated data. These are derived features, not independent observations or labels. |
| Rock, sand, crater, safe/unsafe classes | No available target variable | The rationale text in labels describes scene selection; it is not a pixel-wise annotation and cannot be used as a hazard label. |

**No reliable supervised target is available.** There are no expert-reviewed
hazard labels, obstacle masks, landing outcomes, rover traversal costs, or
ground-truth terrain classes. MOLA elevation is a measurement/product layer,
not a target for predicting route safety. Image intensity alone is not a
defensible proxy label.

## Existing project data and code

The MARTIAN MAP workspace already contains:

- `backend/data/megt90n000cb.img` with a PDS label: global MOLA at 0.25°,
  coarser than the supplied 0.0625° MOLA product.
- `backend/data/jezero-ctx-20m.tif`: local 20 m/pixel Jezero CTX elevation
  raster used by the landing/surface-analysis features.
- `backend/data/robbins-craters.npz`: a crater catalog extract.
- A deterministic terrain analysis and A* route planner in
  `backend/app/terrain.py` and `backend/app/planner.py`. The legacy local
  planner uses synthetic demo terrain unless `MARS_DEM_PATH` is configured.
  These calculations are explicit models/rules, not learned ML predictions.

Before this audit, there was no existing ML training/inference pipeline or
`reports/` directory.
The backend environment has NumPy, SciPy and Rasterio; pandas, scikit-learn,
GeoPandas, Shapely, PyProj, Xarray, Pillow, OpenCV and PyTorch were not
available in the checked environment. No dependencies were installed.

## Dataset compatibility

- The supplied MOLA grid is global, and each HiRISE scene lies within its
  geographic coverage. They can be spatially compared only after the PDS
  projection metadata is correctly decoded and the coordinate/datum
  conventions are checked.
- Their nominal scales are fundamentally different: 0.0625° MOLA cells
  (about 3.7 km north-south at the equator, with longitude distance varying
  by latitude) versus 0.25 m/pixel in the HiRISE source labels. The MOLA
  product is roughly four orders of magnitude coarser. Resampling MOLA to a
  finer grid would not create local detail.
- HiRISE coverage is sparse and non-contiguous. Only one QLOOK raster is
  present; the other scenes are metadata-only. The raster's georeferencing
  must be reconstructed and independently checked before any spatial join.
- Existing project MOLA is also a different grid resolution. The supplied
  and bundled rasters must not be concatenated or treated as equivalent cells
  without alignment, resolution, and product-version checks.
- No MCD climate, THEMIS thermal, rover traverse, or HiRISE stereo DTM files
  are supplied here. Those data cannot be inferred from the labels or
  quicklook.

## Recommended tasks and limitations

1. **Supported now:** quality-controlled elevation ingestion and explicitly
   derived terrain measurements (e.g. slope and neighborhood relief), followed
   by deterministic route-cost analysis. Keep measured, derived, simulated,
   and modeled values visibly distinct.
2. **Not supported now:** supervised terrain classification, image hazard
   detection/segmentation, landing-site suitability prediction, learned route
   cost, or a validated ML safety score. There are no labels and insufficient
   independent scenes for defensible training and spatially separated testing.
3. **Exploratory only:** unsupervised texture/anomaly analysis could identify
   unusual image patches for human review, but with one available quicklook it
   cannot establish that an anomaly is a rock, dune, hazard, or safe/unsafe
   terrain. It must not be presented as a trained safety model.

The current data supports a reproducible geospatial analysis pipeline, but it
does not support a scientifically validated predictive ML model. New
independent scenes, co-registered elevation data, documented masks/labels,
labeling protocol, and held-out spatial validation would be needed before
training a hazard model.
