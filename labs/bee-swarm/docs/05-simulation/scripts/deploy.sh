#!/bin/bash

# Bee Swarm 部署腳本
# 用法: ./deploy.sh [development|staging|production] [version]

set -e

# 配置變數
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENVIRONMENT="${1:-development}"
VERSION="${2:-latest}"

# 顏色輸出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# 檢查環境參數
validate_environment() {
    case $ENVIRONMENT in
        development|staging|production)
            log "部署環境: $ENVIRONMENT"
            ;;
        *)
            error "無效的環境參數: $ENVIRONMENT"
            echo "支援的環境: development, staging, production"
            exit 1
            ;;
    esac
}

# 檢查必要工具
check_dependencies() {
    log "檢查必要的工具..."
    
    local deps=("docker" "docker-compose")
    
    if [ "$ENVIRONMENT" = "production" ]; then
        deps+=("kubectl" "aws")
    fi
    
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            error "缺少必要工具: $dep"
            exit 1
        fi
    done
    
    success "所有必要工具已安裝"
}

# 設置環境變數
setup_environment() {
    log "設置環境變數..."
    
    # 載入環境配置
    ENV_FILE="$PROJECT_ROOT/.env.$ENVIRONMENT"
    if [ -f "$ENV_FILE" ]; then
        source "$ENV_FILE"
        success "已載入環境配置: $ENV_FILE"
    else
        warning "環境配置檔案不存在: $ENV_FILE"
    fi
    
    # 設置預設值
    export IMAGE_TAG="${VERSION}"
    export ENVIRONMENT="${ENVIRONMENT}"
    export BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    export GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
}

# 構建映像
build_images() {
    log "構建 Docker 映像..."
    
    cd "$PROJECT_ROOT"
    
    # 構建 API 映像
    docker build -t "bee-swarm-api:$VERSION" \
        --build-arg BUILD_DATE="$BUILD_DATE" \
        --build-arg GIT_COMMIT="$GIT_COMMIT" \
        -f Dockerfile .
    
    # 構建模擬器映像
    docker build -t "bee-swarm-simulator:$VERSION" \
        --build-arg BUILD_DATE="$BUILD_DATE" \
        --build-arg GIT_COMMIT="$GIT_COMMIT" \
        -f Dockerfile.simulator .
    
    success "映像構建完成"
}

# 推送映像到註冊表
push_images() {
    if [ "$ENVIRONMENT" != "development" ]; then
        log "推送映像到註冊表..."
        
        local registry="$DOCKER_REGISTRY"
        if [ -z "$registry" ]; then
            error "未設置 DOCKER_REGISTRY 環境變數"
            exit 1
        fi
        
        # 標記並推送映像
        docker tag "bee-swarm-api:$VERSION" "$registry/bee-swarm-api:$VERSION"
        docker tag "bee-swarm-simulator:$VERSION" "$registry/bee-swarm-simulator:$VERSION"
        
        docker push "$registry/bee-swarm-api:$VERSION"
        docker push "$registry/bee-swarm-simulator:$VERSION"
        
        success "映像推送完成"
    fi
}

# 部署到開發環境
deploy_development() {
    log "部署到開發環境..."
    
    cd "$PROJECT_ROOT"
    
    # 停止現有服務
    docker-compose -f docker-compose.dev.yml down
    
    # 啟動服務
    docker-compose -f docker-compose.dev.yml up -d
    
    # 等待服務啟動
    sleep 30
    
    # 健康檢查
    if health_check "http://localhost:8000/health"; then
        success "開發環境部署成功"
    else
        error "開發環境部署失敗"
        exit 1
    fi
}

# 部署到 Kubernetes
deploy_kubernetes() {
    log "部署到 Kubernetes ($ENVIRONMENT)..."
    
    cd "$PROJECT_ROOT/k8s"
    
    # 更新映像版本
    find . -name "*.yaml" -exec sed -i "s|image: bee-swarm.*:.*|image: $DOCKER_REGISTRY/bee-swarm-api:$VERSION|g" {} \;
    find . -name "*.yaml" -exec sed -i "s|image: bee-swarm-simulator.*:.*|image: $DOCKER_REGISTRY/bee-swarm-simulator:$VERSION|g" {} \;
    
    # 應用配置
    kubectl apply -f namespace.yaml
    kubectl apply -f configmap.yaml
    kubectl apply -f secret.yaml
    kubectl apply -f postgres-deployment.yaml
    kubectl apply -f redis-deployment.yaml
    kubectl apply -f api-deployment.yaml
    kubectl apply -f simulator-deployment.yaml
    kubectl apply -f ingress.yaml
    
    # 等待部署完成
    kubectl rollout status deployment/bee-swarm-api -n bee-swarm --timeout=300s
    kubectl rollout status deployment/bee-swarm-simulator -n bee-swarm --timeout=300s
    
    success "Kubernetes 部署完成"
}

# 健康檢查
health_check() {
    local url="$1"
    local max_attempts=10
    local attempt=1
    
    log "執行健康檢查: $url"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$url" > /dev/null; then
            success "健康檢查通過"
            return 0
        fi
        
        warning "健康檢查失敗 (嘗試 $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done
    
    error "健康檢查失敗"
    return 1
}

# 執行資料庫遷移
run_migrations() {
    log "執行資料庫遷移..."
    
    if [ "$ENVIRONMENT" = "development" ]; then
        docker-compose -f docker-compose.dev.yml exec bee-swarm-api python -m alembic upgrade head
    else
        kubectl exec -n bee-swarm deployment/bee-swarm-api -- python -m alembic upgrade head
    fi
    
    success "資料庫遷移完成"
}

# 清理舊資源
cleanup() {
    log "清理舊資源..."
    
    # 清理未使用的 Docker 映像
    docker image prune -f
    
    # 清理舊的 Kubernetes 資源 (如果適用)
    if [ "$ENVIRONMENT" != "development" ]; then
        kubectl delete pods -n bee-swarm --field-selector=status.phase=Succeeded
    fi
    
    success "清理完成"
}

# 發送部署通知
send_notification() {
    local status="$1"
    local message="$2"
    
    if [ -n "$SLACK_WEBHOOK" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{
                \"text\": \"🚀 Bee Swarm 部署 $status\",
                \"attachments\": [{
                    \"color\": \"$([ "$status" = "成功" ] && echo "good" || echo "danger")\",
                    \"fields\": [
                        {\"title\": \"環境\", \"value\": \"$ENVIRONMENT\", \"short\": true},
                        {\"title\": \"版本\", \"value\": \"$VERSION\", \"short\": true},
                        {\"title\": \"時間\", \"value\": \"$(date)\", \"short\": false}
                    ],
                    \"text\": \"$message\"
                }]
            }" \
            "$SLACK_WEBHOOK"
    fi
}

# 主要執行流程
main() {
    log "開始 Bee Swarm 部署流程..."
    log "環境: $ENVIRONMENT, 版本: $VERSION"
    
    # 驗證參數
    validate_environment
    
    # 檢查依賴
    check_dependencies
    
    # 設置環境
    setup_environment
    
    # 構建映像
    build_images
    
    # 推送映像 (非開發環境)
    push_images
    
    # 根據環境進行部署
    case $ENVIRONMENT in
        development)
            deploy_development
            ;;
        staging|production)
            deploy_kubernetes
            ;;
    esac
    
    # 執行資料庫遷移
    run_migrations
    
    # 清理資源
    cleanup
    
    # 發送通知
    send_notification "成功" "部署已完成，版本 $VERSION 已成功部署到 $ENVIRONMENT 環境"
    
    success "部署流程完成！"
}

# 錯誤處理
trap 'error "部署過程中發生錯誤"; send_notification "失敗" "部署過程中發生錯誤，請檢查日誌"; exit 1' ERR

# 顯示使用說明
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Bee Swarm 部署腳本"
    echo ""
    echo "用法:"
    echo "  $0 [environment] [version]"
    echo ""
    echo "參數:"
    echo "  environment  部署環境 (development, staging, production)"
    echo "  version      部署版本 (預設: latest)"
    echo ""
    echo "範例:"
    echo "  $0 development"
    echo "  $0 production v1.0.0"
    echo ""
    echo "環境變數:"
    echo "  DOCKER_REGISTRY  Docker 註冊表地址"
    echo "  SLACK_WEBHOOK    Slack 通知 Webhook URL"
    exit 0
fi

# 執行主函數
main "$@" 