from pricing import apply_discount


def submit_order(cents: int) -> int:
    return apply_discount(cents, 10)


def unrelated_healthcheck() -> str:
    return "ok"
