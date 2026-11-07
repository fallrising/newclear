"""A small pricing module used as a structural-analysis oracle."""


def apply_discount(cents: int, percent: int) -> int:
    return cents * (100 - percent) // 100


def legacy_total(cents: int) -> int:
    return cents
