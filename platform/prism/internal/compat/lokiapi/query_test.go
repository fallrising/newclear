package lokiapi

import (
	"context"
	"encoding/json"
	"mime"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/prometheus/prometheus/model/labels"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

const (
	nsStart   = "1757030400000000000"
	nsEnd     = "1757030401000000000"
	nsNow     = "1757034000000000000"
	zeroStats = `{"summary":{"bytesProcessedPerSecond":0,"execTime":0,"totalBytesProcessed":0,"totalLinesProcessed":0},"ingester":{},"store":{}}`
	ac29Body  = `{"status":"success","data":{"resultType":"streams","result":[{"stream":{"host":"h1"},"values":[["1757030400500000000","new"],["1757030400000000000","old"]]}],"stats":` + zeroStats + `}}`
	ac29Path  = `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=` + nsStart + `&end=` + nsEnd
)

type fixedClock struct{ now time.Time }

func (c fixedClock) Now() time.Time { return c.now }

type statsLogs struct {
	spi.LogStore
	stats   spi.LogStats
	queries []spi.LogQuery
}

func (s *statsLogs) Stats(_ context.Context, q spi.LogQuery) (spi.LogStats, error) {
	s.queries = append(s.queries, q)
	if q.Tenant != "default" {
		return spi.LogStats{}, nil
	}
	return s.stats, nil
}

type statsBackend struct {
	spi.Backend
	logs spi.LogStore
}

func (b statsBackend) Logs() spi.LogStore { return b.logs }

func openHandler(t *testing.T, now int64) (*QueryHandler, spi.Backend) {
	t.Helper()
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	return newHandler(t, backend, now), backend
}

func newHandler(t *testing.T, backend spi.Backend, now int64) *QueryHandler {
	t.Helper()
	var clock spi.Clock
	if now != 0 {
		clock = fixedClock{utm.NanoToTime(now)}
	}
	handler, err := NewQueryHandler(backend, QueryOptions{
		Tenant:             "default",
		AllowAnonymousRead: true,
		MaxRange:           7 * 24 * time.Hour,
		Clock:              clock,
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func writeLogs(t *testing.T, backend spi.Backend, recs ...utm.LogRecord) {
	t.Helper()
	for i := range recs {
		if recs[i].Resource == nil {
			recs[i].Resource = &utm.Resource{Tenant: "default"}
		}
	}
	if err := backend.Logs().Write(t.Context(), recs); err != nil {
		t.Fatal(err)
	}
}

func doGet(t *testing.T, handler *QueryHandler, path string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	response := httptest.NewRecorder()
	handler.HTTPHandler().ServeHTTP(response, request)
	return response
}

func assertJSON(t *testing.T, response *httptest.ResponseRecorder, body string) {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("status %d body %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("content-type %q", response.Header().Get("Content-Type"))
	}
	if response.Body.String() != body {
		t.Fatalf("body %s\nwant %s", response.Body.String(), body)
	}
}

func assertPlain(t *testing.T, response *httptest.ResponseRecorder, body string) {
	t.Helper()
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %q", response.Code, response.Body.String())
	}
	if response.Body.String() != body {
		t.Fatalf("body %q\nwant %q", response.Body.String(), body)
	}
	if response.Header().Get("X-Prism-Error-Class") != string(spi.ErrBadRequest) {
		t.Fatalf("class %q", response.Header().Get("X-Prism-Error-Class"))
	}
	mediaType, _, err := mime.ParseMediaType(response.Header().Get("Content-Type"))
	if err != nil || mediaType != "text/plain" {
		t.Fatalf("content-type %q", response.Header().Get("Content-Type"))
	}
	if response.Body.Len() == 0 || response.Body.Bytes()[0] == '{' {
		t.Fatalf("body %q", response.Body.String())
	}
}

func TestQuery_AC29_QueryRangeStreams(t *testing.T) {
	handler, backend := openHandler(t, 0)
	writeLogs(t, backend,
		utm.LogRecord{TS: 1757030400000000000, Body: "old", Labels: labels.FromStrings("host", "h1")},
		utm.LogRecord{TS: 1757030400500000000, Body: "new", Labels: labels.FromStrings("host", "h1")},
	)
	assertJSON(t, doGet(t, handler, ac29Path), ac29Body)
	rfc := `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=2025-09-05T00:00:00.000000000Z&end=2025-09-05T00:00:01.000000000Z`
	assertJSON(t, doGet(t, handler, rfc), ac29Body)
}

func TestQuery_AC30_EndExclusive(t *testing.T) {
	handler, backend := openHandler(t, 0)
	writeLogs(t, backend,
		utm.LogRecord{TS: 1757030400000000000, Body: "old", Labels: labels.FromStrings("host", "h1")},
		utm.LogRecord{TS: 1757030400500000000, Body: "new", Labels: labels.FromStrings("host", "h1")},
		utm.LogRecord{TS: 1757030401000000000, Body: "nope", Labels: labels.FromStrings("host", "h1")},
	)
	assertJSON(t, doGet(t, handler, ac29Path), ac29Body)
}

func TestQuery_AC31_DefaultRangeAndRelativeStart(t *testing.T) {
	handler, backend := openHandler(t, 1757034000000000000)
	writeLogs(t, backend,
		utm.LogRecord{TS: 1757030400000000000, Body: "old", Labels: labels.FromStrings("host", "h1")},
		utm.LogRecord{TS: 1757030400500000000, Body: "new", Labels: labels.FromStrings("host", "h1")},
	)
	assertJSON(t, doGet(t, handler, `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D`), ac29Body)
	assertJSON(t, doGet(t, handler, `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=1h`), ac29Body)
	assertPlain(t, doGet(t, handler, `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=1d`), "start must be unix nanoseconds, RFC3339Nano, or a Go duration")
}

func TestQuery_AC32_MatrixStep(t *testing.T) {
	handler, backend := openHandler(t, 0)
	writeLogs(t, backend, utm.LogRecord{TS: 1757030400000000000, Body: "line", Labels: labels.FromStrings("host", "h1")})
	one := `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{"host":"h1"},"values":[[1757030400,"1"]]}],"stats":` + zeroStats + `}}`
	path := `/loki/api/v1/query_range?query=count_over_time(%7Bhost%3D%22h1%22%7D%5B1s%5D)&start=` + nsStart + `&end=1757030700000000000&step=`
	assertJSON(t, doGet(t, handler, path+"300"), one)
	assertJSON(t, doGet(t, handler, path+"5m"), one)
	assertPlain(t, doGet(t, handler, path+"300&direction=Backward"), "direction must be forward or backward")
	assertPlain(t, doGet(t, handler, path+"1d"), "step must be a Go duration or a number of seconds")
	assertPlain(t, doGet(t, handler, path+"0"), "step must be a Go duration or a number of seconds")
	assertPlain(t, doGet(t, handler, path+"-1"), "step must be a Go duration or a number of seconds")
	four := `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{"host":"h1"},"values":[[1757030400,"1"],[1757030415,"0"],[1757030430,"0"],[1757030445,"0"]]}],"stats":` + zeroStats + `}}`
	assertJSON(t, doGet(t, handler, `/loki/api/v1/query_range?query=count_over_time(%7Bhost%3D%22h1%22%7D%5B1s%5D)&start=`+nsStart+`&end=1757030460000000000`), four)
}

func TestQuery_AC33_InstantVector(t *testing.T) {
	handler, backend := openHandler(t, 1757030400000000000)
	writeLogs(t, backend, utm.LogRecord{TS: 1757030399999999999, Body: "line", Labels: labels.FromStrings("host", "h1")})
	body := `{"status":"success","data":{"resultType":"vector","result":[{"metric":{"host":"h1"},"value":[1757030400,"1"]}],"stats":` + zeroStats + `}}`
	assertJSON(t, doGet(t, handler, `/loki/api/v1/query?query=count_over_time(%7Bhost%3D%22h1%22%7D%5B1s%5D)&time=`+nsStart), body)
	assertJSON(t, doGet(t, handler, `/loki/api/v1/query?query=count_over_time(%7Bhost%3D%22h1%22%7D%5B1s%5D)`), body)
	assertPlain(t, doGet(t, handler, `/loki/api/v1/query?query=%7Bhost%3D%22h1%22%7D`), "instant queries are only supported for metric queries")
}

func TestQuery_AC34_SubsecondStep(t *testing.T) {
	handler, backend := openHandler(t, 0)
	writeLogs(t, backend, utm.LogRecord{TS: 1757030400000000000, Body: "line", Labels: labels.FromStrings("host", "h1")})
	body := `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{"host":"h1"},"values":[[1757030400,"1"],[1757030400.5,"0"]]}],"stats":` + zeroStats + `}}`
	path := `/loki/api/v1/query_range?query=count_over_time(%7Bhost%3D%22h1%22%7D%5B500ms%5D)&start=` + nsStart + `&end=` + nsEnd + `&step=`
	assertJSON(t, doGet(t, handler, path+"500ms"), body)
	assertJSON(t, doGet(t, handler, path+"0.5"), body)
}

func TestQuery_AC35_LimitAndDirection(t *testing.T) {
	handler, backend := openHandler(t, 0)
	recs := make([]utm.LogRecord, 101)
	for i := range recs {
		recs[i] = utm.LogRecord{
			TS:     1757030400000000000 + int64(i),
			Body:   "line-" + strconv.Itoa(i),
			Labels: labels.FromStrings("host", "h1"),
		}
	}
	writeLogs(t, backend, recs...)
	response := doGet(t, handler, `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=`+nsStart+`&end=1757030400000000101`)
	if response.Code != http.StatusOK {
		t.Fatalf("status %d body %q", response.Code, response.Body.String())
	}
	var payload struct {
		Data struct {
			Result []struct {
				Values [][2]string `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Data.Result) != 1 || len(payload.Data.Result[0].Values) != 100 {
		t.Fatalf("values %#v", payload.Data.Result)
	}
	values := payload.Data.Result[0].Values
	if values[0] != [2]string{"1757030400000000100", "line-100"} || values[99] != [2]string{"1757030400000000001", "line-1"} {
		t.Fatalf("edges %v %v", values[0], values[99])
	}
	for _, value := range values {
		if value[1] == "line-0" {
			t.Fatal("line-0 was kept")
		}
	}
	forward := doGet(t, handler, `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=`+nsStart+`&end=1757030400000000101&direction=forward&limit=1`)
	if err := json.Unmarshal(forward.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if forward.Code != http.StatusOK || len(payload.Data.Result) != 1 || len(payload.Data.Result[0].Values) != 1 || payload.Data.Result[0].Values[0] != [2]string{"1757030400000000000", "line-0"} {
		t.Fatalf("forward %d %#v", forward.Code, payload.Data.Result)
	}
	assertPlain(t, doGet(t, handler, `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=`+nsStart+`&end=`+nsEnd+`&limit=5001`), "max entries limit per query exceeded, limit > max_entries_limit_per_query (5001 > 5000)")
	assertPlain(t, doGet(t, handler, `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=`+nsStart+`&end=`+nsEnd+`&direction=Backward`), "direction must be forward or backward")
	assertPlain(t, doGet(t, handler, `/loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=`+nsStart+`&end=`+nsEnd+`&limit=0`), "limit must be a positive integer")
}

func TestQuery_AC36_Labels(t *testing.T) {
	handler, backend := openHandler(t, 1757034000000000000)
	assertJSON(t, doGet(t, handler, `/loki/api/v1/labels?start=`+nsStart+`&end=`+nsEnd), `{"status":"success","data":[]}`)
	writeLogs(t, backend,
		utm.LogRecord{TS: 1757012400000000000, Body: "in", Labels: labels.FromStrings("app", "api", "host", "h1")},
		utm.LogRecord{TS: 1757012399999999999, Body: "out", Labels: labels.FromStrings("only", "out")},
	)
	assertJSON(t, doGet(t, handler, `/loki/api/v1/labels`), `{"status":"success","data":["app","host"]}`)
}

func TestQuery_AC37_LabelValues(t *testing.T) {
	handler, backend := openHandler(t, 0)
	path := `/loki/api/v1/label/host/values?start=` + nsStart + `&end=` + nsEnd
	assertJSON(t, doGet(t, handler, path), `{"status":"success","data":[]}`)
	writeLogs(t, backend, utm.LogRecord{TS: 1757030400000000000, Body: "line", Labels: labels.FromStrings("app", "api", "host", "h1")})
	assertJSON(t, doGet(t, handler, path), `{"status":"success","data":["h1"]}`)
	assertJSON(t, doGet(t, handler, `/loki/api/v1/label/missing/values?start=`+nsStart+`&end=`+nsEnd), `{"status":"success","data":[]}`)
}

func TestQuery_AC38_Series(t *testing.T) {
	handler, backend := openHandler(t, 1757034000000000000)
	bounded := `/loki/api/v1/series?start=` + nsStart + `&end=` + nsEnd + `&match[]=%7Bhost%3D%22h1%22%7D`
	assertJSON(t, doGet(t, handler, bounded), `{"status":"success","data":[]}`)
	writeLogs(t, backend,
		utm.LogRecord{TS: 1757030400000000000, Body: "line", Labels: labels.FromStrings("app", "api", "host", "h1")},
		utm.LogRecord{TS: 1757012400000000000, Body: "edge", Labels: labels.FromStrings("host", "edge")},
		utm.LogRecord{TS: 1757012399999999999, Body: "out", Labels: labels.FromStrings("host", "out")},
	)
	assertJSON(t, doGet(t, handler, bounded), `{"status":"success","data":[{"app":"api","host":"h1"}]}`)
	assertJSON(t, doGet(t, handler, `/loki/api/v1/series?match[]=%7Bhost%3D~%22.%2B%22%7D`), `{"status":"success","data":[{"app":"api","host":"h1"},{"host":"edge"}]}`)
	assertPlain(t, doGet(t, handler, `/loki/api/v1/series?start=`+nsStart+`&end=`+nsEnd), "at least one match[] parameter is required")
}

func TestQuery_AC39_IndexStats(t *testing.T) {
	handler, _ := openHandler(t, 0)
	statsPath := `/loki/api/v1/index/stats?query=%7Bhost%3D%22h1%22%7D&start=` + nsStart + `&end=` + nsEnd
	assertJSON(t, doGet(t, handler, statsPath), `{"streams":0,"chunks":0,"entries":0,"bytes":0}`)

	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	writeLogs(t, backend,
		utm.LogRecord{TS: 1757030400000000000, Body: "old", Labels: labels.FromStrings("host", "h1")},
		utm.LogRecord{TS: 1757030400500000000, Body: "new", Labels: labels.FromStrings("host", "h1")},
	)
	logs := &statsLogs{LogStore: backend.Logs(), stats: spi.LogStats{
		Streams: 2, Chunks: 3, TotalLinesProcessed: 4, TotalBytesProcessed: 100, ExecTimeSeconds: 0.5,
	}}
	counted := newHandler(t, statsBackend{Backend: backend, logs: logs}, 0)
	assertJSON(t, doGet(t, counted, statsPath), `{"streams":2,"chunks":3,"entries":4,"bytes":100}`)
	withStats := `{"status":"success","data":{"resultType":"streams","result":[{"stream":{"host":"h1"},"values":[["1757030400500000000","new"],["1757030400000000000","old"]]}],"stats":{"summary":{"bytesProcessedPerSecond":200,"execTime":0.5,"totalBytesProcessed":100,"totalLinesProcessed":4},"ingester":{},"store":{}}}}`
	assertJSON(t, doGet(t, counted, ac29Path), withStats)
	if len(logs.queries) != 2 || logs.queries[1].Tenant != "default" {
		t.Fatalf("query_range stats queries %#v", logs.queries)
	}
}

func TestQuery_AC41_ErrorEnvelope(t *testing.T) {
	handler, _ := openHandler(t, 0)
	assertPlain(t, doGet(t, handler, `/loki/api/v1/query_range?query=%7Bjob%3DSECRET%7D&start=`+nsStart+`&end=`+nsEnd), "parse error at line 1, col 6: syntax error: unexpected IDENTIFIER, expecting STRING")
	assertPlain(t, doGet(t, handler, `/loki/api/v1/query_range?query=%7Bjob%21%3D%22%22%7D&start=`+nsStart+`&end=`+nsEnd), "queries require at least one regexp or equality matcher that does not have an empty-compatible value")
	assertPlain(t, doGet(t, handler, `/loki/api/v1/query_range?start=`+nsStart+`&end=`+nsEnd), "query is required")
}
