package com.fallrising.cms.media.store;

import java.util.Optional;

public interface MediaObjectStore {

    void put(String objectKey, byte[] bytes);

    Optional<byte[]> get(String objectKey);

    void delete(String objectKey);
}
