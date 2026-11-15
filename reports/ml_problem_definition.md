# ML Problem Definition

## Decision

**No predictive ML task is selected for training with the data currently
available.** The supplied collection has elevation and image measurements but
no reliable target labels. Training a supervised model now would require
inventing labels or using scene-description text as if it were pixel ground
truth; neither is scientifically defensible.

This is a deliberate no-model decision, not a claim that the data has no
scientific value. The data can support geospatial ingestion, quality checks,
terrain-feature derivation, visualization, and deterministic route planning.

## What the data can and cannot answer

| Question | Current evidence | Decision |
|---|---|---|
| What is the gridded global topography? | MOLA MEGDR elevations and PDS product metadata | Can be read and analyzed at the product's coarse native scale, while retaining the distinction between observed and interpolated bins where possible. |
| Where are local visual surface patterns in the available scene? | One HiRISE QLOOK image and its PDS label | Can be displayed after validating the PDS map transform. Pixels are not hazard labels, and image intensity alone does not establish material or traversability. |
| Which image pixels are rocks, dunes, craters, safe, or unsafe? | No reviewed pixel masks or class labels | Cannot train or validate a supervised detector/classifier. |
| What is the local elevation/slope in the HiRISE image? | No co-registered HiRISE DTM in the supplied collection | Cannot derive high-resolution slope from the image label or intensity. |
| Which candidate route has lower modeled cost? | Existing terrain-derived rules and A* implementation in MARTIAN MAP | Can be calculated as a rule-based planning estimate, not represented as an ML prediction or operational safety guarantee. |

## Selected current method: explicit terrain rules, not ML

For current route planning, retain the project's transparent calculations
from available elevation, slope, roughness, mobility assumptions, and
configured constraints. A* can compare shortest, safest, and weighted
objectives over the traversability grid. The outputs should continue to be
identified as derived terrain features and model estimates.

- **Input features:** elevation raster values plus source metadata; slope and
  roughness only when derived using documented spatial units and valid-data
  handling; mobility-profile parameters and user-configured weights.
- **Target variable:** none. This is not a trained prediction problem.
- **Output:** calculated terrain layers and route candidates with their
  assumptions and limitations, rather than a learned class, probability, or
  model confidence.
- **Scientific assumptions:** elevation is interpreted in the source
  product's vertical reference; local distance calculations respect Mars
  planetary coordinates; raster resolution is not sharpened by resampling;
  missing/interpolated data is surfaced rather than silently treated as
  ground truth.
- **Limitations:** MOLA is too coarse for small obstacles; the available
  HiRISE quicklook has no embedded georeferencing or verified nodata mask;
  local HiRISE elevation and soil-strength data are absent; roughness is not a
  direct measurement of sand, rock abundance, or wheel/foot traction. Route
  costs are estimates and do not certify safety.

## Future ML candidate (blocked pending data)

If sufficient data becomes available, the most defensible first ML candidate
is **supervised image-based terrain/hazard segmentation for a narrowly
defined class set**, not a general "safe route" predictor.

- **Inputs:** calibrated, georeferenced HiRISE image patches and, where
  available, co-registered high-resolution DTM-derived slope/roughness
  channels.
- **Target:** expert-reviewed pixel masks with a documented annotation
  protocol and explicit classes (for example, visible rock, dune/sand,
  crater/edge, and unknown). A broad safe/unsafe label should not be inferred
  from appearance alone.
- **Expected output:** per-pixel class estimates with a clear "unknown /
  insufficient data" state. Any confidence would require calibration and
  independent validation before being interpreted probabilistically.
- **Validation:** split by geographically distinct scenes/regions, not random
  neighboring pixels; keep entire scenes or spatial blocks out of training
  and tuning. Report class-wise precision, recall, F1 and intersection over
  union, plus confusion matrices and error review. Do not claim route safety
  from segmentation alone.
- **Data needed first:** multiple georeferenced scenes, usable product
  documentation/calibration, suitable high-resolution terrain coverage,
  expert labels, and independently held-out spatial scenes.

Unsupervised anomaly detection on the single available QLOOK could at most
surface unusual-looking patches for human inspection. It has no ground-truth
hazard semantics and no meaningful independent-scene test set; therefore it
is not selected as a route-planning model.

## Model, metrics and API status

- **Model recommended now:** none; do not train or save a model.
- **Training/evaluation metrics:** not applicable until a labeled task and
  independent spatial test set exist. Reporting synthetic or proxy-label
  accuracy would be misleading.
- **Model explainability/confidence:** not applicable. The existing route
  calculations should instead expose their input features, rules, data
  sources, and limitations.
- **ML prediction API:** not proposed. Existing rule-based route APIs remain
  distinct from any future ML endpoint; no endpoint should imply a model was
  trained.

## Approval boundary

This definition and the companion dataset audit document the inspection
phase only. No raw-data files were changed, no preprocessing was run, no
model was trained, and no application code or dependencies were changed.
Further implementation should wait for review of this problem definition and
approval of the next phase.
