package dev.ojbk.gateway.consume;

import com.google.protobuf.ByteString;
import ojbk.v1.AckRequest;
import ojbk.v1.AckResponse;
import ojbk.v1.Code;
import ojbk.v1.ConsumerServiceGrpc;
import ojbk.v1.MessageOut;
import ojbk.v1.PollRequest;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.GroupConfig;
import dev.ojbk.security.TokenAuth;
import io.grpc.stub.StreamObserver;
import java.time.Duration;
import java.util.Objects;

final class ConsumerGrpcService
        extends ConsumerServiceGrpc.ConsumerServiceImplBase {
    private static final Duration ACK_TIMEOUT = Duration.ofSeconds(5);

    private final ConfigStore store;
    private final PullGateway gateway;

    ConsumerGrpcService(ConfigStore store, PullGateway gateway) {
        this.store = Objects.requireNonNull(store, "store");
        this.gateway = Objects.requireNonNull(gateway, "gateway");
    }

    @Override
    public void poll(
            PollRequest request, StreamObserver<MessageOut> responseObserver) {
        Code auth = authenticate(request.getGroup(), token(request.getToken()));
        if (auth != Code.OK) {
            respondError(responseObserver, auth, "group authentication failed");
            return;
        }
        if (request.getTopic().isBlank()
                || request.getMaxBatch() < 1
                || request.getMaxBatch() > 500
                || request.getLingerMs() < 0
                || request.getLingerMs() > 30_000) {
            respondError(
                    responseObserver,
                    Code.INVALID_ARGUMENT,
                    "topic, maxBatch, or lingerMs is invalid");
            return;
        }

        PullPollResult result;
        try {
            result = gateway.poll(
                    request.getGroup(),
                    request.getTopic(),
                    request.getMaxBatch(),
                    Duration.ofMillis(request.getLingerMs()));
        } catch (RuntimeException failure) {
            result = PullPollResult.unavailable();
        }
        if (result.code() != Code.OK) {
            respondError(responseObserver, result.code(), result.message());
            return;
        }
        result.deliveries().stream()
                .map(ConsumerGrpcService::message)
                .forEach(responseObserver::onNext);
        responseObserver.onCompleted();
    }

    @Override
    public void ack(
            AckRequest request, StreamObserver<AckResponse> responseObserver) {
        Code auth = authenticate(request.getGroup(), token(request.getToken()));
        PullAckResult result;
        if (auth != Code.OK) {
            result = new PullAckResult(auth, "group authentication failed");
        } else {
            try {
                result = gateway.acknowledge(
                        request.getGroup(),
                        request.getAckList(),
                        request.getNackList(),
                        ACK_TIMEOUT);
            } catch (RuntimeException failure) {
                result = PullAckResult.unavailable();
            }
        }
        responseObserver.onNext(AckResponse.newBuilder()
                .setCode(result.code())
                .setMsg(result.message())
                .build());
        responseObserver.onCompleted();
    }

    private Code authenticate(String groupName, String providedToken) {
        if (groupName == null || groupName.isBlank()) {
            return Code.INVALID_ARGUMENT;
        }
        GroupConfig group = store.group(groupName).orElse(null);
        if (group == null
                || !group.enabled()
                || !TokenAuth.matches(group.token(), providedToken)) {
            return Code.AUTH_FAILED;
        }
        return Code.OK;
    }

    private static MessageOut message(PullDelivery delivery) {
        MessageOut.Builder output = MessageOut.newBuilder()
                .setTopic(delivery.topic())
                .setPartition(delivery.partition())
                .setOffset(delivery.offset())
                .setValue(ByteString.copyFrom(delivery.value()))
                .addAllTags(delivery.tags())
                .putAllHeaders(delivery.headers())
                .setAckToken(delivery.ackToken())
                .setDeliveryCount(delivery.deliveryCount())
                .setCode(Code.OK);
        if (delivery.key() != null) {
            output.setKey(delivery.key());
        }
        return output.build();
    }

    private static void respondError(
            StreamObserver<MessageOut> responseObserver,
            Code code,
            String message) {
        responseObserver.onNext(MessageOut.newBuilder()
                .setCode(code)
                .setMsg(message == null ? "" : message)
                .build());
        responseObserver.onCompleted();
    }

    private static String token(String bodyToken) {
        String metadataToken = ConsumerTokenInterceptor.TOKEN_CONTEXT.get();
        return metadataToken == null || metadataToken.isBlank()
                ? bodyToken
                : metadataToken;
    }
}
