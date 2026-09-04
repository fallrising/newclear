import {
  Alert,
  Button,
  Empty,
  Flex,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import type {ReactNode} from "react";
import {ApiError} from "./api";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Flex className="page-heading" justify="space-between" align="flex-start" gap={24}>
      <div>
        <Typography.Text className="eyebrow">{eyebrow}</Typography.Text>
        <Typography.Title level={1}>{title}</Typography.Title>
        <Typography.Paragraph>{description}</Typography.Paragraph>
      </div>
      {action}
    </Flex>
  );
}

export function ResourceState({enabled}: {enabled: boolean}) {
  return (
    <Tag color={enabled ? "success" : "default"}>
      {enabled ? "Active" : "Paused"}
    </Tag>
  );
}

export function QueryState({
  loading,
  error,
  empty,
  retry,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty?: boolean;
  retry?: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return <Skeleton active paragraph={{rows: 5}} />;
  }
  if (error) {
    const detail =
      error instanceof ApiError ? `${error.code}: ${error.message}` : "The request failed";
    return (
      <Result
        status="error"
        title="Unable to load this view"
        subTitle={detail}
        extra={retry && <Button onClick={retry}>Try again</Button>}
      />
    );
  }
  if (empty) {
    return <Empty description="Nothing here yet" />;
  }
  return children;
}

export function MutationError({error}: {error: unknown}) {
  if (!error) return null;
  return (
    <Alert
      showIcon
      type="error"
      message={error instanceof Error ? error.message : "The request failed"}
    />
  );
}

export function Version({value}: {value: number}) {
  return (
    <Space size={6}>
      <span className="version-dot" />
      <Typography.Text type="secondary">v{value} desired</Typography.Text>
    </Space>
  );
}
