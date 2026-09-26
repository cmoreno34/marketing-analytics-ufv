"""Reference output for the elasticity maths (src/lib/elasticity.js).

Fits the same log-log models with statsmodels and writes
test/elasticity_reference.json, which test/elasticity.test.js compares against.

    python test/ref_elasticity.py
"""
import json
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from statsmodels.stats.anova import anova_lm

out = {}

# 1. The 14 pairs of the univariate Colab.
pairs = [(2.4, 62), (2.4, 53), (2.4, 51), (2.45, 58), (2.47, 58), (2.53, 47), (2.57, 48),
         (2.59, 39), (2.6, 43), (2.6, 45), (2.65, 42), (2.67, 43), (2.71, 38), (2.73, 33)]
rain = [0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1]
df = pd.DataFrame(pairs, columns=["price", "units"])
df["rain"] = rain
df["lp"], df["lq"] = np.log(df.price), np.log(df.units)

m = smf.ols("lq ~ lp", df).fit()
out["pairs"] = {"beta": m.params.tolist(), "se": m.bse.tolist(), "p": m.pvalues.tolist(), "r2": m.rsquared}

# 2. Rain: one model with interaction, the model without it, and the Colab's
#    two separate regressions.
full = smf.ols("lq ~ lp + C(rain) + lp:C(rain)", df).fit()
restr = smf.ols("lq ~ lp + C(rain)", df).fit()
F = anova_lm(restr, full)
out["rain"] = {
    "full": {"names": list(full.params.index), "beta": full.params.tolist(), "se": full.bse.tolist(),
             "p": full.pvalues.tolist(), "r2": full.rsquared, "adjR2": full.rsquared_adj},
    "slopeF": float(F["F"][1]), "slopeP": float(F["Pr(>F)"][1]),
    "eps_rain": float(full.params["lp"] + full.params["lp:C(rain)[T.1]"]),
    "se_rain": float(np.sqrt(full.cov_params().loc["lp", "lp"] + full.cov_params().loc["lp:C(rain)[T.1]", "lp:C(rain)[T.1]"]
                             + 2 * full.cov_params().loc["lp", "lp:C(rain)[T.1]"])),
    "separate": {str(k): smf.ols("lq ~ lp", g).fit().params["lp"] for k, g in df.groupby("rain")},
}

# 3. A synthetic set with everything at once: a three-level segment with its
#    own elasticity, a two-level shifter and a numeric covariate in logs.
rng = np.random.default_rng(7)
n = 240
seg = rng.choice(["online", "store", "kiosk"], n)
day = rng.choice(["weekday", "weekend"], n)
temp = np.round(rng.uniform(8, 32, n), 1)
price = np.round(rng.uniform(1.5, 3.5, n), 2)
eps = pd.Series({"online": -2.4, "store": -1.6, "kiosk": -1.1})[seg].to_numpy()
units = 40 * (price / 2.5) ** eps * np.where(day == "weekend", 1.3, 1) * (temp / 20) ** 0.5 * np.exp(rng.normal(0, 0.15, n))
syn = pd.DataFrame({"price": price, "units": np.round(units, 2), "channel": seg, "day": day, "temp": temp})
syn.to_csv("test/elasticity_synth.csv", index=False)
syn["lp"], syn["lq"], syn["lt"] = np.log(syn.price), np.log(syn.units), np.log(syn.temp)
# Treatment coding with the alphabetical first level as base, as the lab does.
f = smf.ols("lq ~ lp + C(channel) + C(day) + lt + lp:C(channel)", syn).fit()
r = smf.ols("lq ~ lp + C(channel) + C(day) + lt", syn).fit()
F = anova_lm(r, f)
cov = f.cov_params()
eps_by = {"kiosk": (f.params["lp"], np.sqrt(cov.loc["lp", "lp"]))}
for lv in ["online", "store"]:
    k = f"lp:C(channel)[T.{lv}]"
    eps_by[lv] = (f.params["lp"] + f.params[k], np.sqrt(cov.loc["lp", "lp"] + cov.loc[k, k] + 2 * cov.loc["lp", k]))
out["synth"] = {
    "names": list(f.params.index), "beta": f.params.tolist(), "se": f.bse.tolist(), "p": f.pvalues.tolist(),
    "r2": f.rsquared, "df": f.df_resid, "slopeF": float(F["F"][1]), "slopeP": float(F["Pr(>F)"][1]),
    "eps": {k: [float(v[0]), float(v[1])] for k, v in eps_by.items()},
    "ci_kiosk": f.conf_int().loc["lp"].tolist(),
}

json.dump(out, open("test/elasticity_reference.json", "w"), indent=1)
print("pairs eps", round(out["pairs"]["beta"][1], 6), "r2", round(out["pairs"]["r2"], 4))
print("rain eps no-rain / rain", round(out["rain"]["full"]["beta"][1], 4), round(out["rain"]["eps_rain"], 4), "F p", round(out["rain"]["slopeP"], 4))
print("synth eps", {k: round(v[0], 3) for k, v in out["synth"]["eps"].items()}, "F p", out["synth"]["slopeP"])
