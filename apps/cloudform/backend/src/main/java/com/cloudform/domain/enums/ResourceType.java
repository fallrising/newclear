package com.cloudform.domain.enums;

public enum ResourceType {
    RDS("關係型數據庫"),
    ELASTICSEARCH("搜索引擎"),
    REDIS("緩存"),
    MONGODB("文檔數據庫"),
    CLICKHOUSE("分析型數據庫");

    private final String displayName;

    ResourceType(String displayName) {
        this.displayName = displayName;
    }

    public String getDisplayName() {
        return displayName;
    }
}
