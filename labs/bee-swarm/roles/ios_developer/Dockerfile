# 基於VNC Lab的iOS開發者角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建iOS開發工作目錄結構
RUN mkdir -p /app/ios_developer \
    /app/projects \
    /app/ios_projects \
    /app/frameworks \
    /app/tests \
    /app/docs

# 複製iOS開發腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建iOS開發用戶
RUN useradd -m -s /bin/bash ios_developer \
    && chown -R ios_developer:ios_developer /app

# 切換到iOS開發用戶
USER ios_developer

# 設置環境變量
ENV ROLE_NAME=ios_developer
ENV ROLE_TYPE=ios_developer
ENV WORKSPACE=/app/projects
ENV IOS_WORKSPACE=/app/ios_projects
ENV FRAMEWORK_WORKSPACE=/app/frameworks
ENV TEST_WORKSPACE=/app/tests

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 