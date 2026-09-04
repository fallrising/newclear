package dev.ojbk.gateway.produce;

import ojbk.v1.CancelDelayRequest;
import ojbk.v1.Code;
import ojbk.v1.DelayRequest;
import ojbk.v1.DelayResponse;
import ojbk.v1.MessageIn;
import ojbk.v1.ProduceAck;
import ojbk.v1.ProduceRequest;
import ojbk.v1.ProduceResponse;
import ojbk.v1.ProducerServiceGrpc;
import io.grpc.stub.StreamObserver;
import java.util.Objects;

public final class ProducerGrpcService extends ProducerServiceGrpc.ProducerServiceImplBase {
    private final ProducerEngine engine;
    private final DelayGateway delay;

    public ProducerGrpcService(ProducerEngine engine) {
        this(engine, null);
    }

    public ProducerGrpcService(ProducerEngine engine, DelayGateway delay) {
        this.engine = Objects.requireNonNull(engine, "engine");
        this.delay = delay;
    }

    @Override
    public void produce(ProduceRequest request, StreamObserver<ProduceResponse> responseObserver) {
        responseObserver.onNext(produce(request));
        responseObserver.onCompleted();
    }

    @Override
    public StreamObserver<ProduceRequest> produceBatch(
            StreamObserver<ProduceResponse> responseObserver) {
        return new StreamObserver<>() {
            @Override
            public void onNext(ProduceRequest request) {
                responseObserver.onNext(produce(request));
            }

            @Override
            public void onError(Throwable failure) {
                responseObserver.onError(failure);
            }

            @Override
            public void onCompleted() {
                responseObserver.onCompleted();
            }
        };
    }

    @Override
    public void produceDelay(
            DelayRequest request, StreamObserver<DelayResponse> responseObserver) {
        if (delay == null) {
            responseObserver.onNext(unsupported(request.getDelayId()));
            responseObserver.onCompleted();
            return;
        }
        if (!request.hasMsg()) {
            responseObserver.onNext(DelayResponse.newBuilder()
                    .setCode(Code.INVALID_ARGUMENT)
                    .setMsg("message is required")
                    .setDelayId(request.getDelayId())
                    .build());
            responseObserver.onCompleted();
            return;
        }
        DelayGatewayResult result = delay.schedule(
                message(request.getMsg()),
                token(request.getToken()),
                request.getDelayId(),
                request.getDueAtMs(),
                request.hasLoopIntervalMs() ? request.getLoopIntervalMs() : null,
                request.hasLoopTimes() ? request.getLoopTimes() : null,
                request.hasExpireAtMs() ? request.getExpireAtMs() : null);
        responseObserver.onNext(delayResponse(result));
        responseObserver.onCompleted();
    }

    @Override
    public void cancelDelay(
            CancelDelayRequest request, StreamObserver<DelayResponse> responseObserver) {
        if (delay == null) {
            responseObserver.onNext(unsupported(request.getDelayId()));
            responseObserver.onCompleted();
            return;
        }
        responseObserver.onNext(delayResponse(
                delay.cancel(request.getTopic(), token(request.getToken()), request.getDelayId())));
        responseObserver.onCompleted();
    }

    private ProduceResponse produce(ProduceRequest request) {
        if (!request.hasMsg()) {
            return ProduceResponse.newBuilder()
                    .setCode(Code.INVALID_ARGUMENT)
                    .setMsg("message is required")
                    .build();
        }
        ProducerResult result = engine.produce(message(request.getMsg()), token(request.getToken()));
        ProduceResponse.Builder response =
                ProduceResponse.newBuilder().setCode(result.code()).setMsg(result.message());
        if (result.ack() != null) {
            response.setAck(ProduceAck.newBuilder()
                    .setTopic(result.ack().topic())
                    .setPartition(result.ack().partition())
                    .setOffset(result.ack().offset()));
        }
        return response.build();
    }

    private static ProducerMessage message(MessageIn message) {
        return new ProducerMessage(
                message.getTopic(),
                message.hasKey() ? message.getKey() : null,
                message.getValue().toByteArray(),
                message.getTagsList(),
                message.getHeadersMap(),
                message.hasPartition() ? message.getPartition() : null);
    }

    private static String token(String bodyToken) {
        String metadataToken = TokenMetadataInterceptor.TOKEN_CONTEXT.get();
        return metadataToken == null || metadataToken.isBlank() ? bodyToken : metadataToken;
    }

    private static DelayResponse delayResponse(DelayGatewayResult result) {
        return DelayResponse.newBuilder()
                .setCode(result.code())
                .setMsg(result.message())
                .setDelayId(result.delayId())
                .build();
    }

    private static DelayResponse unsupported(String delayId) {
        return DelayResponse.newBuilder()
                .setCode(Code.UNSUPPORTED)
                .setMsg("delay scheduling is not configured")
                .setDelayId(delayId)
                .build();
    }
}
