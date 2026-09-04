package dev.ojbk.config;

import java.util.List;
import java.util.Map;

public interface DeliveryPolicy {
    String filterCel();

    List<String> tags();

    Map<String, String> transit();

    boolean shadowTraffic();
}
