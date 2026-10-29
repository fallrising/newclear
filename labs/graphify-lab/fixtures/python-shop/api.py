from orders import submit_order


def checkout(cents: int) -> int:
    return submit_order(cents)
