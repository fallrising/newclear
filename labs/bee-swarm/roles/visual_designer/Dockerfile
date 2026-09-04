# 基於VNC Lab的視覺設計師角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建視覺設計工作目錄結構
RUN mkdir -p /app/visual_designer \
    /app/projects \
    /app/designs \
    /app/assets \
    /app/templates \
    /app/resources \
    /app/docs

# 複製視覺設計腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建視覺設計用戶
RUN useradd -m -s /bin/bash visual_designer \
    && chown -R visual_designer:visual_designer /app

# 切換到視覺設計用戶
USER visual_designer

# 設置環境變量
ENV ROLE_NAME=visual_designer
ENV ROLE_TYPE=visual_designer
ENV WORKSPACE=/app/projects
ENV DESIGN_WORKSPACE=/app/designs
ENV ASSET_WORKSPACE=/app/assets
ENV TEMPLATE_WORKSPACE=/app/templates
ENV RESOURCE_WORKSPACE=/app/resources

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 