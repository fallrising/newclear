"""Conservative, versioned public-price quote for the next provider adapter.

This is a dry run on the local fixture.  It is not an OpenAI invoice or an
authorization to send a request to OpenAI.  All arithmetic uses integer
nanodollars so admission never rounds a reservation down.
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

PRICE_REVISION = "openai-gpt-4o-mini-2024-07-18-standard-2026-09-24"
PRICE_SOURCE = "https://openai.com/index/api-prompt-caching/"
MODEL_SOURCE = "https://developers.openai.com/api/docs/models/gpt-4o-mini"
MODEL = "gpt-4o-mini-2024-07-18"
CONTEXT_TOKENS = 128_000
INPUT_NANODOLLARS_PER_TOKEN = 150  # USD 0.15 / 1,000,000 tokens
OUTPUT_NANODOLLARS_PER_TOKEN = 600  # USD 0.60 / 1,000,000 tokens
MAX_OUTPUT_TOKENS = 4096
MAX_QUOTE_AGE = timedelta(hours=24)


def parse_utc(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value):
        raise ValueError("invalid_price_quote_time")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("invalid_price_quote_time") from None


@dataclass(frozen=True)
class PublishedPriceQuote:
    """Operator-confirmed public PAYG Standard text price, fixture dry run only."""

    limit_nanodollars: int
    verified_at: str
    expires_at: str
    public_payg_standard_confirmed: bool

    def __post_init__(self):
        verified = parse_utc(self.verified_at)
        expires = parse_utc(self.expires_at)
        if (
            type(self.limit_nanodollars) is not int
            or not 1 <= self.limit_nanodollars <= 10**12
            or self.public_payg_standard_confirmed is not True
            or not verified < expires <= verified + MAX_QUOTE_AGE
        ):
            raise ValueError("invalid_price_quote")

    def valid(self, now=None):
        now = now or datetime.now(UTC)
        return parse_utc(self.verified_at) <= now < parse_utc(self.expires_at)

    def reserve(self, maximum):
        if type(maximum) is not int or not 1 <= maximum <= MAX_OUTPUT_TOKENS:
            raise ValueError("invalid_price_quote_output")
        # The public context window bounds accepted text input; unlike fixture
        # canonical bytes it does not pretend to tokenize the SDK payload.
        return CONTEXT_TOKENS * INPUT_NANODOLLARS_PER_TOKEN + maximum * OUTPUT_NANODOLLARS_PER_TOKEN

    def settle(self, input_tokens, output_tokens, maximum):
        if (
            type(input_tokens) is not int
            or type(output_tokens) is not int
            or not 0 <= input_tokens <= CONTEXT_TOKENS
            or not 0 <= output_tokens <= maximum <= MAX_OUTPUT_TOKENS
        ):
            raise ValueError("price_quote_usage_out_of_bound")
        # Cached input is deliberately billed at the full input rate.  A future
        # provider adapter can apply a discount only with validated cache data.
        return (
            input_tokens * INPUT_NANODOLLARS_PER_TOKEN
            + output_tokens * OUTPUT_NANODOLLARS_PER_TOKEN
        )


def dollars(nanodollars):
    return str(Decimal(nanodollars) / Decimal(10**9))
