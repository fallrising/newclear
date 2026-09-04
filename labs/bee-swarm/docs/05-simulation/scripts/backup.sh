#!/bin/bash

# Bee Swarm 備份腳本
# 用法: ./backup.sh [--type database|files|full] [--retention-days 30]

set -e

# 配置變數
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_BASE_DIR="${BACKUP_DIR:-/backup}"
S3_BUCKET="${S3_BUCKET:-bee-swarm-backups}"
RETENTION_DAYS=30
BACKUP_TYPE="full"
NOTIFICATION_WEBHOOK="${SLACK_WEBHOOK}"

# 解析命令列參數
while [[ $# -gt 0 ]]; do
    case $1 in
        --type)
            BACKUP_TYPE="$2"
            shift 2
            ;;
        --retention-days)
            RETENTION_DAYS="$2"
            shift 2
            ;;
        --status)
            show_backup_status
            exit 0
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "未知參數: $1"
            show_help
            exit 1
            ;;
    esac
done

# 顏色輸出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日誌函數
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 發送通知
send_notification() {
    local status="$1"
    local message="$2"
    
    if [ -n "$NOTIFICATION_WEBHOOK" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{
                \"text\": \"💾 Bee Swarm 備份 $status\",
                \"attachments\": [{
                    \"color\": \"$([ "$status" = "成功" ] && echo "good" || echo "danger")\",
                    \"fields\": [
                        {\"title\": \"類型\", \"value\": \"$BACKUP_TYPE\", \"short\": true},
                        {\"title\": \"時間\", \"value\": \"$(date)\", \"short\": true}
                    ],
                    \"text\": \"$message\"
                }]
            }" \
            "$NOTIFICATION_WEBHOOK" 2>/dev/null || true
    fi
}

# 檢查必要工具
check_dependencies() {
    local deps=("docker" "gzip")
    
    if command -v aws &> /dev/null; then
        deps+=("aws")
    fi
    
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            error "缺少必要工具: $dep"
            exit 1
        fi
    done
}

# 資料庫備份
backup_database() {
    local backup_dir="$BACKUP_BASE_DIR/postgres/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    
    log "開始資料庫備份..."
    
    # PostgreSQL 備份
    if docker ps | grep -q postgres; then
        log "備份 PostgreSQL 資料庫..."
        docker exec postgres pg_dump -U "${POSTGRES_USER:-prod_user}" "${POSTGRES_DB:-bee_swarm_prod}" \
            > "$backup_dir/database.sql"
        
        if [ $? -eq 0 ]; then
            # 壓縮備份檔案
            gzip "$backup_dir/database.sql"
            
            local backup_size=$(du -h "$backup_dir/database.sql.gz" | cut -f1)
            success "資料庫備份完成: $backup_dir/database.sql.gz ($backup_size)"
            
            # 上傳到 S3
            upload_to_s3 "$backup_dir/database.sql.gz" "postgres/"
            
            echo "$backup_dir/database.sql.gz"
        else
            error "資料庫備份失敗"
            return 1
        fi
    else
        warning "PostgreSQL 容器未運行，跳過資料庫備份"
    fi
}

# 檔案備份
backup_files() {
    local backup_dir="$BACKUP_BASE_DIR/application/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    
    log "開始檔案備份..."
    
    # 備份配置檔案
    log "備份配置檔案..."
    local config_files=(
        "/etc/prometheus"
        "/etc/grafana"
        "/opt/bee-swarm/.env*"
        "/var/lib/grafana/dashboards"
    )
    
    for config_path in "${config_files[@]}"; do
        if [ -e "$config_path" ]; then
            tar -czf "$backup_dir/$(basename $config_path).tar.gz" "$config_path" 2>/dev/null || true
        fi
    done
    
    # 備份 Docker volumes
    log "備份 Docker volumes..."
    if docker volume ls | grep -q prometheus_data; then
        docker run --rm -v prometheus_data:/data -v "$backup_dir":/backup alpine \
            tar -czf /backup/prometheus_data.tar.gz -C /data .
    fi
    
    if docker volume ls | grep -q grafana_data; then
        docker run --rm -v grafana_data:/data -v "$backup_dir":/backup alpine \
            tar -czf /backup/grafana_data.tar.gz -C /data .
    fi
    
    # 備份應用程式日誌
    log "備份應用程式日誌..."
    if [ -d "/var/log/bee-swarm" ]; then
        tar -czf "$backup_dir/logs.tar.gz" /var/log/bee-swarm 2>/dev/null || true
    fi
    
    local backup_size=$(du -sh "$backup_dir" | cut -f1)
    success "檔案備份完成: $backup_dir ($backup_size)"
    
    # 上傳到 S3
    upload_to_s3 "$backup_dir" "application/"
    
    echo "$backup_dir"
}

# 上傳到 S3
upload_to_s3() {
    local local_path="$1"
    local s3_prefix="$2"
    
    if command -v aws &> /dev/null && [ -n "$S3_BUCKET" ]; then
        log "上傳備份到 S3: s3://$S3_BUCKET/$s3_prefix"
        
        if [ -d "$local_path" ]; then
            aws s3 sync "$local_path" "s3://$S3_BUCKET/$s3_prefix$(basename $local_path)/" --storage-class STANDARD_IA
        else
            aws s3 cp "$local_path" "s3://$S3_BUCKET/$s3_prefix" --storage-class STANDARD_IA
        fi
        
        if [ $? -eq 0 ]; then
            success "S3 上傳完成"
        else
            warning "S3 上傳失敗"
        fi
    else
        warning "AWS CLI 未安裝或 S3_BUCKET 未設置，跳過雲端備份"
    fi
}

# 清理舊備份
cleanup_old_backups() {
    log "清理 $RETENTION_DAYS 天前的舊備份..."
    
    # 清理本地備份
    find "$BACKUP_BASE_DIR" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
    find "$BACKUP_BASE_DIR" -type d -empty -delete 2>/dev/null || true
    
    # 清理 S3 備份
    if command -v aws &> /dev/null && [ -n "$S3_BUCKET" ]; then
        local cutoff_date=$(date -d "$RETENTION_DAYS days ago" -Iso-8601)
        
        aws s3api list-objects-v2 --bucket "$S3_BUCKET" \
            --query "Contents[?LastModified<='$cutoff_date'].Key" \
            --output text 2>/dev/null | \
        while read -r key; do
            if [ -n "$key" ]; then
                aws s3 rm "s3://$S3_BUCKET/$key"
            fi
        done
    fi
    
    success "舊備份清理完成"
}

# 顯示備份狀態
show_backup_status() {
    echo "=== Bee Swarm 備份狀態 ==="
    echo ""
    
    # 本地備份
    echo "本地備份："
    if [ -d "$BACKUP_BASE_DIR" ]; then
        local local_count=$(find "$BACKUP_BASE_DIR" -name "*.gz" -o -name "*.tar.gz" | wc -l)
        local local_size=$(du -sh "$BACKUP_BASE_DIR" 2>/dev/null | cut -f1 || echo "0")
        echo "  檔案數量: $local_count"
        echo "  總大小: $local_size"
        echo "  最新備份: $(find "$BACKUP_BASE_DIR" -name "*.gz" -o -name "*.tar.gz" | head -1 || echo "無")"
    else
        echo "  無本地備份"
    fi
    
    echo ""
    
    # S3 備份
    echo "S3 備份："
    if command -v aws &> /dev/null && [ -n "$S3_BUCKET" ]; then
        local s3_count=$(aws s3 ls "s3://$S3_BUCKET" --recursive | wc -l 2>/dev/null || echo "0")
        echo "  檔案數量: $s3_count"
        echo "  S3 儲存桶: $S3_BUCKET"
    else
        echo "  AWS CLI 未配置或 S3_BUCKET 未設置"
    fi
}

# 顯示說明
show_help() {
    echo "Bee Swarm 備份腳本"
    echo ""
    echo "用法:"
    echo "  $0 [選項]"
    echo ""
    echo "選項:"
    echo "  --type TYPE          備份類型 (database, files, full)"
    echo "  --retention-days N   保留天數 (預設: 30)"
    echo "  --status            顯示備份狀態"
    echo "  --help, -h          顯示此說明"
    echo ""
    echo "環境變數:"
    echo "  BACKUP_DIR          備份目錄 (預設: /backup)"
    echo "  S3_BUCKET          S3 儲存桶名稱"
    echo "  SLACK_WEBHOOK      Slack 通知 URL"
    echo "  POSTGRES_USER      PostgreSQL 使用者名稱"
    echo "  POSTGRES_DB        PostgreSQL 資料庫名稱"
    echo ""
    echo "範例:"
    echo "  $0                              # 完整備份"
    echo "  $0 --type database              # 僅備份資料庫"
    echo "  $0 --type files                 # 僅備份檔案"
    echo "  $0 --retention-days 7           # 保留 7 天"
    echo "  $0 --status                     # 查看備份狀態"
}

# 主要執行流程
main() {
    log "開始 Bee Swarm 備份流程 (類型: $BACKUP_TYPE)..."
    
    # 檢查依賴
    check_dependencies
    
    # 建立備份目錄
    mkdir -p "$BACKUP_BASE_DIR"
    
    local success_count=0
    local backup_files=()
    
    # 根據備份類型執行
    case $BACKUP_TYPE in
        database)
            if backup_file=$(backup_database); then
                backup_files+=("$backup_file")
                ((success_count++))
            fi
            ;;
        files)
            if backup_file=$(backup_files); then
                backup_files+=("$backup_file")
                ((success_count++))
            fi
            ;;
        full)
            if backup_file=$(backup_database); then
                backup_files+=("$backup_file")
                ((success_count++))
            fi
            if backup_file=$(backup_files); then
                backup_files+=("$backup_file")
                ((success_count++))
            fi
            ;;
        *)
            error "無效的備份類型: $BACKUP_TYPE"
            exit 1
            ;;
    esac
    
    # 清理舊備份
    cleanup_old_backups
    
    # 發送通知
    if [ $success_count -gt 0 ]; then
        local message="備份已完成，共 $success_count 個備份檔案"
        send_notification "成功" "$message"
        success "備份流程完成！"
        
        # 顯示備份檔案
        echo ""
        echo "備份檔案："
        for file in "${backup_files[@]}"; do
            echo "  - $file"
        done
    else
        send_notification "失敗" "備份過程中發生錯誤"
        error "備份流程失敗"
        exit 1
    fi
}

# 錯誤處理
trap 'error "備份過程中發生錯誤"; send_notification "失敗" "備份過程中發生錯誤，請檢查日誌"; exit 1' ERR

# 執行主函數
main "$@" 