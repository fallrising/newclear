# 基於VNC Lab的項目管理師角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建項目管理工作目錄結構
RUN mkdir -p /app/project_manager \
    /app/projects \
    /app/documents \
    /app/reports \
    /app/meetings \
    /app/templates \
    /app/docs

# 複製項目管理腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建項目管理用戶
RUN useradd -m -s /bin/bash project_manager \
    && chown -R project_manager:project_manager /app

# 切換到項目管理用戶
USER project_manager

# 設置環境變量
ENV ROLE_NAME=project_manager
ENV ROLE_TYPE=project_manager
ENV WORKSPACE=/app/projects
ENV DOCUMENT_WORKSPACE=/app/documents
ENV REPORT_WORKSPACE=/app/reports
ENV MEETING_WORKSPACE=/app/meetings
ENV TEMPLATE_WORKSPACE=/app/templates

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 