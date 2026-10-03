package otlp

import (
	"net/http"
	"strconv"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
)

// Retry hints are bounded and apply only to safely retryable whole requests.
func classifiedStatus(err error, retry time.Duration) *status.Status {
	class := errorClass(err)
	code := codes.Internal
	switch class {
	case spi.ErrBadRequest:
		code = codes.InvalidArgument
	case spi.ErrUnsupported:
		code = codes.Unimplemented
	case spi.ErrNotFound:
		code = codes.NotFound
	case spi.ErrTooLarge, spi.ErrThrottled:
		code = codes.ResourceExhausted
	case spi.ErrUnavailable:
		code = codes.Unavailable
	case spi.ErrTimeout:
		code = codes.DeadlineExceeded
	}
	st := status.New(code, "OTLP "+string(class))
	detail := &errdetails.ErrorInfo{Reason: string(class), Domain: "prism.ingest"}
	if with, err := st.WithDetails(detail); err == nil {
		st = with
	}
	if spi.Retryable(class) {
		retry = max(time.Second, min(retry, time.Minute))
		if with, err := st.WithDetails(&errdetails.RetryInfo{RetryDelay: durationpb.New(retry)}); err == nil {
			st = with
		}
	}
	return st
}
func writeStatus(w http.ResponseWriter, code int, st *status.Status, class string, json bool) {
	w.Header().Set("X-Prism-Error-Class", class)
	var body []byte
	if json {
		w.Header().Set("Content-Type", "application/json")
		body, _ = protojson.Marshal(st.Proto())
	} else {
		w.Header().Set("Content-Type", "application/x-protobuf")
		body, _ = proto.Marshal(st.Proto())
	}
	w.WriteHeader(code)
	_, _ = w.Write(body)
}
func writeFailure(w http.ResponseWriter, err error, retry time.Duration, json bool) {
	class := errorClass(err)
	code := spi.HTTPStatus(class)
	if class == spi.ErrTooLarge {
		code = http.StatusRequestEntityTooLarge
	}
	if class == spi.ErrUnsupported {
		code = http.StatusUnsupportedMediaType
	}
	st := classifiedStatus(err, retry)
	if spi.Retryable(class) {
		delay := max(time.Second, min(retry, time.Minute))
		w.Header().Set("Retry-After", strconv.FormatInt(int64((delay+time.Second-1)/time.Second), 10))
	}
	writeStatus(w, code, st, string(class), json)
}

func errorClass(err error) spi.ErrClass {
	switch class := spi.Classify(err); class {
	case spi.ErrBadRequest, spi.ErrUnsupported, spi.ErrNotFound, spi.ErrTooLarge, spi.ErrThrottled, spi.ErrUnavailable, spi.ErrTimeout, spi.ErrInternal:
		return class
	default:
		return spi.ErrInternal
	}
}
