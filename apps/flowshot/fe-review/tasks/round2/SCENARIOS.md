# Flowshot R2 scenario evidence map

Original M1/M2 only. `home` remains `/`; scenarios are driver-controlled synthetic promises, not routes.

| Scenario | Viewports/preferences | Required oracle/artifact |
| --- | --- | --- |
| loading | desktop/tablet/mobile × light/dark | Pending promise, Connecting heading, no native call; six PNGs/metrics |
| ready | same six | Observed loading before resolve, exact synthetic Version/Revision/Profile, Foundation ready; six PNGs/metrics |
| error | same six | Observed loading before typed reject, error heading/alert, no unhandled rejection; six PNGs/metrics |
| long-ready | mobile light | Long metadata still present in DOM, ellipsis/layout measured; one PNG/metrics |

Each uses a new context, pre-navigation preload, exact loaded URL and actual HTTP status. Record all axe violations/incomplete and browser findings; a full Round3 conclusion is not implied. Fixture and driver guards have independent negative tests. Missing fixture, unknown native use, state mismatch or cleanup failure cannot pass the R2 runtime gate.
