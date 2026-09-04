# 基於VNC Lab的產品經理角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建產品經理工作目錄結構
RUN mkdir -p /app/product_manager \
    /app/projects \
    /app/templates \
    /app/docs

# 複製產品經理腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建產品經理用戶
RUN useradd -m -s /bin/bash product_manager \
    && chown -R product_manager:product_manager /app

# 切換到產品經理用戶
USER product_manager

# 設置環境變量
ENV ROLE_NAME=product_manager
ENV ROLE_TYPE=product_manager
ENV WORKSPACE=/app/projects
ENV TEMPLATES=/app/templates
ENV DOCS=/app/docs

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 