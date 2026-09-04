# 基於VNC Lab的數據工程師角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建數據工程工作目錄結構
RUN mkdir -p /app/data_engineer \
    /app/data \
    /app/pipelines \
    /app/models \
    /app/reports \
    /app/notebooks \
    /app/docs

# 複製數據工程腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建數據工程用戶
RUN useradd -m -s /bin/bash data_engineer \
    && chown -R data_engineer:data_engineer /app

# 切換到數據工程用戶
USER data_engineer

# 設置環境變量
ENV ROLE_NAME=data_engineer
ENV ROLE_TYPE=data_engineer
ENV WORKSPACE=/app/data
ENV PIPELINE_WORKSPACE=/app/pipelines
ENV MODEL_WORKSPACE=/app/models
ENV REPORT_WORKSPACE=/app/reports
ENV NOTEBOOK_WORKSPACE=/app/notebooks

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 