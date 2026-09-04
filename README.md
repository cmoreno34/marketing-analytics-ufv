# Marketing Analytics — Analysis tools

Browser-based tools for **Marketing Analytics** (César Moreno Pascual, PhD — Universidad Francisco de Vitoria).

**Live:** https://cmoreno34.github.io/marketing-analytics-ufv/

| Tool | URL | Module |
|---|---|---|
| Segmentation Lab | [`#/segmentation`](https://cmoreno34.github.io/marketing-analytics-ufv/#/segmentation) | 4 |
| RFM Lab | [`#/rfm`](https://cmoreno34.github.io/marketing-analytics-ufv/#/rfm) | 4 |
| Sector Research | [`#/sector-research`](https://cmoreno34.github.io/marketing-analytics-ufv/#/sector-research) | 4 |

## Segmentation Lab

Four clustering algorithms on one dataset, scored with the same indices so they can actually be compared.

- **K-Means** — k-means++ seeding, configurable restarts, a fixed seed so results reproduce.
- **K-Prototypes** — numeric *and* categorical variables together (Huang), with a tunable gamma.
- **Hierarchical** — Ward, average, complete and single linkage. Full dendrogram, a linkage matrix in SciPy's layout, and the merge-gap table that tells you where to cut. Gower distance for mixed data.
- **DBSCAN** — density-based, finds its own number of clusters, and labels outliers as noise instead of forcing everyone into a segment. Includes the k-distance curve and an automatic eps suggestion.
- **Compare all** — every applicable algorithm at the same k, plus an Adjusted Rand Index matrix showing how much they agree.

Validation is not an afterthought: **silhouette** (mean, per cluster and the per-point plot), **Davies–Bouldin** and **Calinski–Harabasz**, all shown against k so the choice can be defended.

### Your data never leaves your browser

Files are parsed in the page. Nothing is uploaded, nothing is stored. Close the tab and it is gone. That is what makes these safe to use with real project data.

The one exception is explicit and opt-in: if you ask Claude to read your segments, the **centroid table** (means and modes per segment, plus sizes and validation scores) is sent to the course service. Your rows are not.

## Correctness

The clustering maths is checked against SciPy on every build:

```bash
npm install
python test/ref.py          # regenerates the SciPy reference (needs scipy + pandas)
node --test test/algorithms.test.js
```

26 tests cover all four linkage methods against `scipy.cluster.hierarchy.linkage`, `fcluster` cuts, DBSCAN partitions at three eps values, silhouette against a reference implementation, and the k-means invariants.

## Development

```bash
npm install
npm run dev      # http://localhost:5173/marketing-analytics-ufv/
npm run build
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`.

## The AI service

The optional interpretation and sector-research features call a small Cloudflare Worker that holds the course Anthropic key, so students do not need one. See [`worker/README.md`](worker/README.md).

**The tools are fully usable without it.** Clustering, every chart, the validation indices and the CSV export need no service at all. Where a tool would call the service, it also offers *Show the prompt* — the exact request, ready to paste into Claude or ChatGPT.

## Credits

The Segmentation Lab began as a port of the `clustering_lab.jsx` Claude artifact (K-Means and K-Prototypes, canvas rendering, the centroid table). Added since: hierarchical clustering and DBSCAN, the three validation indices and the silhouette plot, the algorithm comparison with ARI, seeded reproducibility, k-means++ seeding, Gower distance, the RFM lab, the sector-research agent, and the SciPy test suite.
