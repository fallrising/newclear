package otlp

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"mime"
	"net/http"

	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"go.opentelemetry.io/collector/pdata/plog/plogotlp"
	"go.opentelemetry.io/collector/pdata/pmetric/pmetricotlp"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// HTTPHandler serves only the three OTLP POST endpoints.
func (r *Receiver) HTTPHandler() http.Handler {
	mux := http.NewServeMux()
	for _, signal := range []string{"metrics", "logs", "traces"} {
		mux.HandleFunc("POST /v1/"+signal, func(w http.ResponseWriter, request *http.Request) { r.exportHTTP(w, request, signal) })
		mux.HandleFunc("/v1/"+signal, func(w http.ResponseWriter, request *http.Request) {
			w.Header().Set("Allow", "POST")
			media, _, _ := mime.ParseMediaType(request.Header.Get("Content-Type"))
			writeStatus(w, http.StatusMethodNotAllowed, status.New(codes.InvalidArgument, "OTLP requires POST"), string(spi.ErrBadRequest), media == "application/json")
		})
	}
	return mux
}
func (r *Receiver) exportHTTP(w http.ResponseWriter, request *http.Request, signal string) {
	media, _, mediaErr := mime.ParseMediaType(request.Header.Get("Content-Type"))
	json := media == "application/json"
	authenticated, err := r.authenticate(request.Header.Values("Authorization"), request.Header.Values("X-Scope-OrgID"), request.Header.Values("X-Prism-Tenant"))
	if !authenticated {
		w.Header().Set("WWW-Authenticate", "Bearer")
		writeStatus(w, http.StatusUnauthorized, status.New(codes.Unauthenticated, "OTLP authentication required"), string(spi.ErrBadRequest), json)
		return
	}
	if err != nil {
		writeFailure(w, err, 0, json)
		return
	}
	if mediaErr != nil || len(request.Header.Values("Content-Type")) != 1 || (media != "application/json" && media != "application/x-protobuf") {
		writeFailure(w, failure(spi.ErrUnsupported), 0, json)
		return
	}
	encodings := request.Header.Values("Content-Encoding")
	if len(encodings) > 1 || (len(encodings) == 1 && encodings[0] != "" && encodings[0] != "gzip" && encodings[0] != "identity") {
		writeFailure(w, failure(spi.ErrUnsupported), 0, json)
		return
	}
	if err := r.acquire(request.Context()); err != nil {
		writeFailure(w, err, 0, json)
		return
	}
	defer r.release()
	defer func() { _ = request.Body.Close() }()
	// Close a stalled body on runtime/client cancellation; release only after work ends.
	stop := context.AfterFunc(request.Context(), func() { _ = request.Body.Close() })
	defer stop()
	payload, err := readBounded(request.Context(), request.Body, r.maxRequestBytes)
	if err != nil {
		writeFailure(w, err, 0, json)
		return
	}
	if len(encodings) == 1 && encodings[0] == "gzip" {
		reader, err := gzip.NewReader(bytes.NewReader(payload))
		if err != nil {
			writeFailure(w, failure(spi.ErrBadRequest), 0, json)
			return
		}
		payload, err = readBounded(request.Context(), reader, r.maxRequestBytes)
		_ = reader.Close()
		if err != nil {
			writeFailure(w, err, 0, json)
			return
		}
	}
	ctx := ingest.WithTenant(request.Context(), r.tenant)
	response, result, err := r.submitHTTP(ctx, signal, payload, json)
	if err != nil {
		writeFailure(w, err, result.RetryAfter, json)
		return
	}
	if json {
		w.Header().Set("Content-Type", "application/json")
	} else {
		w.Header().Set("Content-Type", "application/x-protobuf")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(response)
}
func readBounded(ctx context.Context, reader io.Reader, limit int) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, spi.Wrap(spi.ErrTimeout, "", "otlp", err)
	}
	payload, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if cause := ctx.Err(); cause != nil {
		return nil, spi.Wrap(spi.ErrTimeout, "", "otlp", cause)
	}
	if len(payload) > limit {
		return nil, failure(spi.ErrTooLarge)
	}
	if err != nil {
		return nil, failure(spi.ErrBadRequest)
	}
	return payload, nil
}

type wireResponse interface {
	MarshalJSON() ([]byte, error)
	MarshalProto() ([]byte, error)
}

func (r *Receiver) submitHTTP(ctx context.Context, signal string, payload []byte, json bool) ([]byte, ingest.Result, error) {
	var result ingest.Result
	kind := metricsExport
	switch signal {
	case "logs":
		kind = logsExport
	case "traces":
		kind = tracesExport
	}
	var validation error
	if json {
		validation = validateJSON(payload)
	} else {
		validation = validateProto(payload, kind)
	}
	if validation != nil {
		return nil, result, validation
	}
	var response wireResponse
	var err error
	switch signal {
	case "metrics":
		request := pmetricotlp.NewExportRequest()
		if json {
			err = request.UnmarshalJSON(payload)
		} else {
			err = decodeProto(payload, request.UnmarshalProto)
		}
		if err != nil {
			return nil, result, failure(spi.ErrBadRequest)
		}
		result, err = r.pipeline.SubmitOTLPMetrics(ctx, request.Metrics(), int64(len(payload)))
		rsp := metricResponse(result)
		response = rsp
	case "logs":
		request := plogotlp.NewExportRequest()
		if json {
			logs, decodeErr := normalize.DecodeOTLPLogsJSON(payload)
			err = decodeErr
			if err == nil {
				request = plogotlp.NewExportRequestFromLogs(logs)
			}
		} else {
			err = decodeProto(payload, request.UnmarshalProto)
		}
		if err != nil {
			return nil, result, failure(spi.ErrBadRequest)
		}
		result, err = r.pipeline.SubmitOTLPLogs(ctx, request.Logs(), int64(len(payload)))
		response = logResponse(result)
	case "traces":
		request := ptraceotlp.NewExportRequest()
		if json {
			err = request.UnmarshalJSON(payload)
		} else {
			err = decodeProto(payload, request.UnmarshalProto)
		}
		if err != nil {
			return nil, result, failure(spi.ErrBadRequest)
		}
		result, err = r.pipeline.SubmitOTLPTraces(ctx, request.Traces(), int64(len(payload)))
		response = traceResponse(result)
	}
	if err != nil {
		return nil, result, err
	}
	// Responses contain bounded counts and fixed diagnostics only, so serialization
	// cannot fail. Never turn accepted data into a retryable whole-request failure.
	var encoded []byte
	if json {
		encoded, _ = response.MarshalJSON()
	} else {
		encoded, _ = response.MarshalProto()
	}
	return encoded, result, nil
}
func metricResponse(result ingest.Result) wireResponse {
	if result.OTLPRejected == 0 && diagnostics(result) == "" {
		return fullResponse{}
	}
	response := pmetricotlp.NewExportResponse()
	response.PartialSuccess().SetRejectedDataPoints(int64(result.OTLPRejected))
	response.PartialSuccess().SetErrorMessage(diagnostics(result))
	return response
}
func logResponse(result ingest.Result) wireResponse {
	if result.OTLPRejected == 0 && diagnostics(result) == "" {
		return fullResponse{}
	}
	response := plogotlp.NewExportResponse()
	response.PartialSuccess().SetRejectedLogRecords(int64(result.OTLPRejected))
	response.PartialSuccess().SetErrorMessage(diagnostics(result))
	return response
}
func traceResponse(result ingest.Result) wireResponse {
	if result.OTLPRejected == 0 && diagnostics(result) == "" {
		return fullResponse{}
	}
	response := ptraceotlp.NewExportResponse()
	response.PartialSuccess().SetRejectedSpans(int64(result.OTLPRejected))
	response.PartialSuccess().SetErrorMessage(diagnostics(result))
	return response
}

// pdata v1.23 serializes an empty partial_success message unconditionally. A
// full success response has no fields, so encode that standard wire form directly.
type fullResponse struct{}

func (fullResponse) MarshalJSON() ([]byte, error)  { return []byte("{}"), nil }
func (fullResponse) MarshalProto() ([]byte, error) { return nil, nil }
