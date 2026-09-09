# Cross-checking against Diesing (2020) -- and a real answer to "is warm/equatorial siliceous ooze radiolarian ooze?"

Pulled the actual published map -- Diesing, M. (2020), "Deep-sea sediments
of the global ocean mapped with Random Forest machine learning algorithm,"
PANGAEA, https://doi.org/10.1594/PANGAEA.911692 -- to test two things: what
it actually looks like (this project had only cited scalar percentages
from it before, never the map itself), and whether it resolves the
Radiolarian-vs-Diatom-ooze question the sparse 106-point sample in our own
validation data couldn't answer confidently.

## Data (not committed to git -- see repo .gitignore)

`data/` (~111MB: the PANGAEA download's GeoTIFFs + shapefile, plus this
folder's own `*_4326.tif` reprojections and `.npy` intermediates) is
gitignored, not committed -- too large for git history, and fully
reproducible: download the dataset zip from
https://doi.org/10.1594/PANGAEA.911692 (Diesing 2020), unzip into `data/`,
then `gdalwarp` each `*.tif` to EPSG:4326 (nearest-neighbour for
`lithology_classes.tif`, bilinear for the probability layers) to produce
the `*_4326.tif` files `plot_diesing_map.py` and the analysis scripts read.

## Yes -- Diesing's real map shows a genuine equatorial Radiolarian Ooze belt, and the paper says so directly

**01-diesing-global-map.png**: the actual pulled-and-reprojected map (native
Wagner IV GeoTIFFs -> EPSG:4326 via `gdalwarp`, nearest-neighbour for the
categorical class raster). Five classes (confirmed by checking argmax of
the five probability layers against the class raster, 99.9% match):
Calcareous sediment, Clay, Diatom ooze, Lithogenous sediment, Radiolarian
ooze -- Diesing keeps diatom and radiolarian separate; this project's
3-class scheme lumps both into one `siliceous-ooze` bucket.

A distinct dark-green Radiolarian Ooze band is visible right at the
equator (clearest in the Pacific and Indian Oceans), separate from the
light-green Diatom Ooze bands at high southern and northern latitudes.
Quantified directly on the full raster (**02-radiolarian-vs-diatom-latitude-otemp.png**,
~89,000 Radiolarian and ~87,000 Diatom pixels): Diatom Ooze is
essentially unimodal cold (median OTEMP 2.2°C, 75th percentile 4.1°C).
Radiolarian Ooze is clearly **bimodal** -- a cold peak overlapping Diatom
Ooze's range, AND a separate warm peak (median across all Radiolarian
pixels 16.2°C, but the warm mode itself sits around 25-30°C). The paper's
own text (fetched directly, not inferred from the map alone) says exactly
this: *"in the Pacific Ocean, radiolarian ooze is mapped widespread in the
vicinity of the Equator... radiolarian ooze [also] appears in the Southern
Ocean as part of an outer siliceous ooze ring around Antarctica."*

**So: yes, mostly.** The classic textbook picture -- equatorial upwelling
-> Radiolarian Ooze, high-latitude upwelling -> Diatom Ooze -- holds in
this independent, comprehensive map far more clearly than it did in the
sparse 106-point Radiolarian Ooze sample checked earlier (which split
almost evenly warm/cold and looked inconclusive).

## An important caveat, checked directly rather than assumed: Diesing's radiolarian training data is the SAME thin sample we already have

Diesing's own training shapefile ships inside the download
(`SimpClass_DuplicatesRemoved_deepsea500.shp`). Matched it against our
Dutkiewicz-style CSV by exact lat/lon (11,026 of 10,484 Diesing points
matched) -- **it is the same underlying point compilation**, not an
independent second ground-truth source: Diesing's 106 (or 99, after his
own filtering) "Rad.Ooze" training points are exactly our own 106
Radiolarian Ooze points, label-for-label. So Diesing's map is not
additional *ground truth* for the equatorial belt -- his map's confidence
there comes from his **Random Forest model generalizing from the same
thin sample using a richer predictor set**: bathymetry, distance to
shore, sea-surface temperature range, sea-surface max primary
productivity, seafloor min temperature, sea-surface max salinity,
salinity range, and **sea-surface min silicate** (fetched from the
published paper, not assumed). Primary productivity and dissolved
silicate supply are much more direct causal drivers of opal production
than the vertical-velocity/temperature pair (OVEL, OTEMP) this project's
own classifier uses -- which is exactly the kind of variable the earlier
OVEL x OTEMP interaction-term test concluded was missing, now with a
real published model confirming that diagnosis with different (better)
covariates and reaching the classic textbook answer.

*(One number worth flagging as unresolved, not swept under the rug: the
paper's text, as fetched, states radiolarian ooze had 1,277 training
samples/12.2% of the dataset -- a real discrepancy against the 99-106
found directly in the downloaded final shapefile. Possibly a different
preprocessing stage (the shapefile's own filename implies deduplication
and a >500m depth cutoff were applied after the number the paper quotes),
possibly a misread of the paper by the fetch step -- not independently
resolved here.)*

## Cross-check: our OTEMP-based present-day model vs. Diesing's map, at the same grid cells

`our_model_vs_diesing_grid.csv` (30,387 oceanic cells where both have a
value): reasonable agreement for the two easier classes -- our
carbonate-ooze cells are Diesing's Calcareous sediment 67% of the time;
our clay cells are Diesing's Clay 59% of the time. For siliceous-ooze,
our cells split 39% Diatom + 22% Radiolarian in Diesing's map (61%
"some biogenic silica," consistent given these are different models).
The one number that lines up with everything else found this week: **19.5%
of the cells we call clay, Diesing calls Radiolarian ooze** -- the same
warm-water blind spot already found in the present-day validation
(0% accuracy on real warm-water siliceous-ooze points) shows up again
against this fully independent product.

## Figures

1. **01-diesing-global-map.png** -- the real, pulled map, reprojected to
   plain lon/lat, real coastlines for context.
2. **02-radiolarian-vs-diatom-latitude-otemp.png** -- |latitude| and OTEMP
   histograms, Radiolarian vs Diatom Ooze pixels, full raster (~87-89k
   pixels each) -- the evidence for the bimodal claim above.

## What this does and does not show

Does show: Diesing's independent map (different algorithm, richer
covariates) corroborates the equatorial-radiolarian / high-latitude-diatom
split from first principles and from the paper's own text, and
independently reproduces the same warm-water blind spot our OTEMP
classifier has, via a different comparison (grid cross-tab, not the
training-label accuracy check from before).

Does not show: new ground truth for the equatorial belt specifically
(Diesing's radiolarian training points are the same 106 we already had) --
so this doesn't resolve the fix, it explains *why* our classifier can't
find one from OVEL/OTEMP/margin alone, and points at which real-world
variables (productivity, dissolved silicate) would be needed to actually
fix it, IF BRIDGE-Valdes or another accessible source has anything
equivalent -- not checked here.
