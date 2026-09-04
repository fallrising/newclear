package dev.ojbk.sdk;

@FunctionalInterface
public interface DeliveryHandler {
    DeliveryResult handle(OjbkDelivery delivery) throws Exception;
}
