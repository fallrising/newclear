# 基於VNC Lab的Unity開發者角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建Unity開發工作目錄結構
RUN mkdir -p /app/unity_developer \
    /app/projects \
    /app/unity_projects \
    /app/assets \
    /app/scripts \
    /app/tests \
    /app/docs

# 複製Unity開發腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建Unity開發用戶
RUN useradd -m -s /bin/bash unity_developer \
    && chown -R unity_developer:unity_developer /app

# 切換到Unity開發用戶
USER unity_developer

# 設置環境變量
ENV ROLE_NAME=unity_developer
ENV ROLE_TYPE=unity_developer
ENV WORKSPACE=/app/projects
ENV UNITY_WORKSPACE=/app/unity_projects
ENV ASSET_WORKSPACE=/app/assets
ENV SCRIPT_WORKSPACE=/app/scripts
ENV TEST_WORKSPACE=/app/tests

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 