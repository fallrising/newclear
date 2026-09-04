# 基於VNC Lab的安卓開發者角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建安卓開發工作目錄結構
RUN mkdir -p /app/android_developer \
    /app/projects \
    /app/android_projects \
    /app/libraries \
    /app/tests \
    /app/docs

# 複製安卓開發腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建安卓開發用戶
RUN useradd -m -s /bin/bash android_developer \
    && chown -R android_developer:android_developer /app

# 切換到安卓開發用戶
USER android_developer

# 設置環境變量
ENV ROLE_NAME=android_developer
ENV ROLE_TYPE=android_developer
ENV WORKSPACE=/app/projects
ENV ANDROID_WORKSPACE=/app/android_projects
ENV LIBRARY_WORKSPACE=/app/libraries
ENV TEST_WORKSPACE=/app/tests

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 