# 基於VNC Lab的QA工程師角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建QA工程師工作目錄結構
RUN mkdir -p /app/qa_engineer \
    /app/projects \
    /app/test_cases \
    /app/test_reports \
    /app/test_data \
    /app/automation \
    /app/docs

# 複製QA工程師腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建QA工程師用戶
RUN useradd -m -s /bin/bash qa_engineer \
    && chown -R qa_engineer:qa_engineer /app

# 切換到QA工程師用戶
USER qa_engineer

# 設置環境變量
ENV ROLE_NAME=qa_engineer
ENV ROLE_TYPE=qa_engineer
ENV WORKSPACE=/app/projects
ENV TEST_CASE_WORKSPACE=/app/test_cases
ENV TEST_REPORT_WORKSPACE=/app/test_reports
ENV TEST_DATA_WORKSPACE=/app/test_data
ENV AUTOMATION_WORKSPACE=/app/automation

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 