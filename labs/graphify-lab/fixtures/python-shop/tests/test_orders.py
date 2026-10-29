from orders import submit_order


def test_submit_order() -> None:
    assert submit_order(1000) == 900
