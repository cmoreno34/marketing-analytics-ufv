import json, numpy as np, pandas as pd
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import pdist, squareform

df = pd.read_csv('public/data/cities.csv', encoding='utf-8-sig')
cols = ['%_age_Black','%_age_Hispanic','%_age_Asian','Median_Age','Unemploymen_ rate','income_per_apita']
X = df[cols].to_numpy(float)
Z = (X - X.mean(0)) / X.std(0)          # population sd, matches prep.js

out = {'cols': cols, 'X': X.tolist(), 'Z': Z.tolist()}
for m in ['ward','average','complete','single']:
    L = linkage(Z, method=m)
    out['linkage_'+m] = L.tolist()
    out['cut4_'+m] = fcluster(L, 4, criterion='maxclust').tolist()

# silhouette, hand-rolled (no sklearn here) against a fixed labelling
def silhouette(Xz, labels):
    D = squareform(pdist(Xz))
    labels = np.asarray(labels); s = np.zeros(len(Xz))
    for i in range(len(Xz)):
        own = labels[i]; same = labels == own; same[i] = False
        if same.sum() == 0: s[i] = 0; continue
        a = D[i][same].mean()
        b = min(D[i][labels == c].mean() for c in set(labels) if c != own)
        s[i] = (b - a) / max(a, b)
    return float(s.mean())

lab = fcluster(linkage(Z, 'ward'), 4, criterion='maxclust') - 1
out['sil_ward4'] = silhouette(Z, lab)
out['labels_ward4'] = lab.tolist()

# DBSCAN reference, implemented directly from the definition
def dbscan(Xz, eps, minpts):
    D = squareform(pdist(Xz)); n = len(Xz); lab = np.full(n, -2); cid = 0
    for i in range(n):
        if lab[i] != -2: continue
        nb = np.where(D[i] <= eps)[0]
        if len(nb) < minpts: lab[i] = -1; continue
        lab[i] = cid; queue = [j for j in nb if j != i]; q = 0
        while q < len(queue):
            j = queue[q]; q += 1
            if lab[j] == -1: lab[j] = cid
            if lab[j] != -2: continue
            lab[j] = cid
            jn = np.where(D[j] <= eps)[0]
            if len(jn) >= minpts:
                queue += [x for x in jn if lab[x] in (-2, -1)]
        cid += 1
    return lab.tolist(), cid
for eps in [1.0, 1.5, 2.0]:
    l, c = dbscan(Z, eps, 4)
    out[f'dbscan_{eps}'] = {'labels': l, 'n': c, 'noise': int(sum(1 for x in l if x == -1))}

json.dump(out, open('test/reference.json','w'))
print('cities rows', len(X), '| ward heights[:5]', [round(h,4) for h in np.array(out['linkage_ward'])[:5,2]])
print('sil ward k=4', round(out['sil_ward4'],6))
for eps in [1.0,1.5,2.0]: print('dbscan eps',eps, out[f'dbscan_{eps}']['n'],'clusters', out[f'dbscan_{eps}']['noise'],'noise')
