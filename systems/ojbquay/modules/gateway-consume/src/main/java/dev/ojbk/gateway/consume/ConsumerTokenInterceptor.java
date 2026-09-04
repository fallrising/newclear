package dev.ojbk.gateway.consume;

import io.grpc.Context;
import io.grpc.Contexts;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;

final class ConsumerTokenInterceptor implements ServerInterceptor {
    static final Metadata.Key<String> TOKEN_HEADER =
            Metadata.Key.of(
                    "x-ojbk-token", Metadata.ASCII_STRING_MARSHALLER);
    static final Context.Key<String> TOKEN_CONTEXT =
            Context.key("x-ojbk-token");

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call,
            Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {
        return Contexts.interceptCall(
                Context.current().withValue(
                        TOKEN_CONTEXT, headers.get(TOKEN_HEADER)),
                call,
                headers,
                next);
    }
}
