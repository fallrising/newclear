"""Strict whitelist for the lab Pi hook probe report; no raw identities."""
CASES = (
    ('missing_token', 401), ('wrong_token', 401), ('unknown_worker', 401),
    ('wrong_route', 401), ('unknown_route', 404), ('malformed_json', 400),
    ('malformed_payload', 401), ('foreign_session', 401), ('foreign_start', 401),
    ('duplicate_start', 401), ('unexpected_event', 401),
)


def verify_hook_boundary(value, *, resumed=False):
    if type(value) is not dict or set(value) != {'schema', 'cases', 'verified'}:
        return False
    if value['schema'] != 'lab.pi.hook-probe.v1' or value['verified'] is not True:
        return False
    expected = CASES + ((('old_token', 401),) if resumed else ())
    cases = value['cases']
    if type(cases) is not list or len(cases) != len(expected):
        return False
    for case, (name, status) in zip(cases, expected):
        if type(case) is not dict or set(case) != {'name', 'status', 'unchanged'}:
            return False
        if case['name'] != name or type(case['status']) is not int or case['status'] != status or case['unchanged'] is not True:
            return False
    return True
