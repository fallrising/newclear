package com.cloudform.domain.enums;

public enum CloudProvider {
    ALIYUN("alicloud", "阿里雲"),
    AWS("aws", "Amazon Web Services");

    private final String tfProviderName;
    private final String displayName;

    CloudProvider(String tfProviderName, String displayName) {
        this.tfProviderName = tfProviderName;
        this.displayName = displayName;
    }

    public String getTfProviderName() {
        return tfProviderName;
    }

    public String getDisplayName() {
        return displayName;
    }
}
