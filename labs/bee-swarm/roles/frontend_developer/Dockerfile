# 基於VNC Lab的前端開發者角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建前端開發工作目錄結構
RUN mkdir -p /app/frontend_developer \
    /app/projects \
    /app/components \
    /app/pages \
    /app/styles \
    /app/tests \
    /app/docs

# 複製前端開發腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建前端開發用戶
RUN useradd -m -s /bin/bash frontend_developer \
    && chown -R frontend_developer:frontend_developer /app

# 切換到前端開發用戶
USER frontend_developer

# 設置環境變量
ENV ROLE_NAME=frontend_developer
ENV ROLE_TYPE=frontend_developer
ENV WORKSPACE=/app/projects
ENV COMPONENT_WORKSPACE=/app/components
ENV PAGE_WORKSPACE=/app/pages
ENV STYLE_WORKSPACE=/app/styles
ENV TEST_WORKSPACE=/app/tests

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 