"""The pre-registered statistics, against known values."""

from mythicsim.stats import clopper_pearson, holm, paired, t_p_two_sided


def test_clopper_pearson_known_values():
    assert clopper_pearson(0, 6) == [0.0, 0.4593]  # "about 46%"
    assert clopper_pearson(6, 6) == [0.5407, 1.0]
    lo, hi = clopper_pearson(3, 6)
    assert abs(lo - 0.1181) < 1e-3 and abs(hi - 0.8819) < 1e-3
    assert clopper_pearson(0, 0) is None


def test_t_p_values():
    assert abs(t_p_two_sided(2.571, 5) - 0.05) < 1e-3   # the 95% critical value, df 5
    assert abs(t_p_two_sided(2.201, 11) - 0.05) < 1e-3  # df 11 (twelve pairs)
    assert abs(t_p_two_sided(0.0, 5) - 1.0) < 1e-9


def test_paired_differences():
    r = paired([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    assert r["n"] == 6 and r["mean"] == 3.5 and r["ci95"] == [1.54, 5.46] and r["p"] < 0.01
    assert paired([2.0, 2.0, 2.0])["p"] == 0.0
    assert paired([0.0, 0.0])["p"] == 1.0
    assert paired([1.0]) is None


def test_holm():
    assert holm([0.01, 0.04, 0.03, 0.5]) == [0.04, 0.09, 0.09, 0.5]
