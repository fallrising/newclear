# 003：版本化 Schema Migrations 任務

## 階段 A：規格與風險

- [x] 定義空 database 與既有 volume 的升級行為。
- [x] 定義 V1–V3 migration history。
- [x] 定義受 guard 保護的 legacy baseline。
- [x] 定義 fail-closed、immutable migration 與 restore 原則。

## 階段 B：Flyway vertical slice

- [x] 加入 Spring Boot 管理的 Flyway dependency。
- [x] 將 `schema.sql` 拆成 V1、V2、V3。
- [x] 關閉 Spring SQL initializer。
- [x] 新增 guarded legacy baseline strategy。
- [x] 確保 migration 在 seed 與 repositories 之前完成。

## 階段 C：Migration tests

- [x] 空 database bootstrap test。
- [x] legacy posts baseline/data-preservation test。
- [x] current pre-Flyway replies preservation test。
- [x] unknown non-empty database fail-closed test。
- [x] 驗證 history、tables 與 indexes。
- [x] 既有 48 項 backend tests 通過。

## 階段 D：操作文件

- [x] 新增 migration authoring rules。
- [x] 新增 production preflight/backup steps。
- [x] 新增 history verification steps。
- [x] 新增 failed migration restore steps。

## 階段 E：整合驗證

- [x] Frontend lint/build 通過。
- [x] Docker build 通過。
- [x] Production container 空 volume smoke 通過。
- [x] Production container legacy volume upgrade smoke 通過。
- [x] GitHub Actions 通過。
