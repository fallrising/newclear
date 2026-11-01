"""Conservative classification of credential assignments in normalized text.

This pure text predicate recognizes two valueless code forms. It does not
execute code, resolve references, skip function bodies, or certify that an
arbitrary document contains no secrets. Callers retain their Unicode and size
bounds; executable/version metadata keeps its stricter original matcher.
"""
from __future__ import annotations

import re


# Preserve substring matching: credential aliases such as serviceToken,
# client_secret, and resetPassword must not evade the literal-value guard.
_ASSIGNMENT = re.compile(r"(api[_-]?key|secret|token|password)\s*([:=])", re.I)
_IDENTIFIER = r"[A-Za-z_$][A-Za-z0-9_$]*"
_IDENTIFIER_ONLY = re.compile(_IDENTIFIER + r"\Z")
_METHOD_HEADER = re.compile(
    r"\s*function\s*\(\s*(?:" + _IDENTIFIER
    + r"(?:\s*,\s*" + _IDENTIFIER + r")*)?\s*\)\s*\{"
)
_NULLARY_MEMBER_CALL = re.compile(
    r"\s*" + _IDENTIFIER + r"(?:\s*\.\s*" + _IDENTIFIER
    + r")+\s*\(\s*\)\s*[,;]"
)


def contains_sensitive_assignment(text: str) -> bool:
    """Reject every assignment finding except narrowly bounded code syntax."""
    for match in _ASSIGNMENT.finditer(text):
        if match.group(1).lower() != "token" or match.group(2) != "=":
            return True
        start = match.start()
        while start and (text[start - 1].isalnum() or text[start - 1] in "_$-"):
            start -= 1
        identifier = text[start:match.start() + len(match.group(1))]
        previous = start - 1
        while previous >= 0 and text[previous].isspace():
            previous -= 1
        qualified = previous >= 0 and text[previous] == "."
        value_start = match.end()
        if (qualified and identifier.lower() != "token"
                and _IDENTIFIER_ONLY.fullmatch(identifier)
                and _METHOD_HEADER.match(text, value_start)):
            continue
        if (identifier == "token" and not qualified
                and _NULLARY_MEMBER_CALL.match(text, value_start)):
            continue
        return True
    return False
