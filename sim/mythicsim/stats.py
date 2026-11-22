"""The few statistics the pre-registered analysis needs (standard library only).

- clopper_pearson: exact 95% interval for a clear rate (k clears of n groups).
- paired: mean paired difference with a 95% Student-t interval and a
  two-sided p-value (paired t-test), for same-seed comparisons.
- holm: Holm's step-down adjustment of a family of p-values.

Results are rounded (4 places) so a last-bit difference between machines'
math libraries can't change a published number.
"""

from __future__ import annotations

import math
import statistics as st

from .llm.progress import t95


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the regularized incomplete beta (Numerical Recipes)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-14:
            break
    return h


def betai(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta I_x(a, b)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1.0 - x)
    bt = math.exp(lbt)
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def t_p_two_sided(t: float, df: int) -> float:
    """Two-sided p-value of a Student-t statistic."""
    return betai(df / 2.0, 0.5, df / (df + t * t))


def paired(diffs: list[float]) -> dict | None:
    """Mean of paired differences, its 95% Student-t interval, and the paired-t p-value."""
    n = len(diffs)
    if n < 2:
        return None
    m = st.mean(diffs)
    sd = st.stdev(diffs)
    se = sd / math.sqrt(n)
    h = t95(n - 1) * se
    p = 1.0 if se == 0 and m == 0 else 0.0 if se == 0 else t_p_two_sided(m / se, n - 1)
    return {"n": n, "mean": round(m, 2), "ci95": [round(m - h, 2), round(m + h, 2)], "p": round(p, 4)}


def holm(pvals: list[float]) -> list[float]:
    """Holm's step-down adjusted p-values (same order as given)."""
    order = sorted(range(len(pvals)), key=lambda i: (pvals[i], i))
    adj = [0.0] * len(pvals)
    run = 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (len(pvals) - rank) * pvals[i]))
        adj[i] = round(run, 4)
    return adj


def _binom_cdf(k: int, n: int, p: float) -> float:
    """P(X <= k) for X ~ Binomial(n, p)."""
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))


def clopper_pearson(k: int, n: int, alpha: float = 0.05) -> list[float] | None:
    """Exact (Clopper-Pearson) interval for a proportion, k successes of n."""
    if n <= 0:
        return None

    def solve(f, want: float) -> float:  # f increasing in p on [0, 1]
        lo, hi = 0.0, 1.0
        for _ in range(80):
            mid = (lo + hi) / 2
            if f(mid) < want:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    lower = 0.0 if k == 0 else solve(lambda p: 1 - _binom_cdf(k - 1, n, p), alpha / 2)
    upper = 1.0 if k == n else solve(lambda p: 1 - _binom_cdf(k, n, p), 1 - alpha / 2)
    return [round(lower, 4), round(upper, 4)]
