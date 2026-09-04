import {ClockCircleOutlined, StopOutlined} from "@ant-design/icons";
import {useMutation} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Space,
  Tag,
  Typography,
} from "antd";
import {useState} from "react";
import {api} from "../api";
import {MutationError, PageHeader} from "../components";
import type {Delay} from "../types";

export function DelayPage() {
  const [delayId, setDelayId] = useState("");
  const [delay, setDelay] = useState<Delay>();
  const lookup = useMutation({
    mutationFn: (id: string) => api<Delay>(`/api/v1/delay/${encodeURIComponent(id)}`),
    onSuccess: setDelay,
  });
  const cancel = useMutation({
    mutationFn: () =>
      api<Delay>(`/api/v1/delay/${encodeURIComponent(delayId)}/cancel`, {
        method: "POST",
      }),
    onSuccess: setDelay,
  });
  return (
    <>
      <PageHeader
        eyebrow="DURABLE SCHEDULING"
        title="Delay inspector"
        description="Look up a scheduled message by ID and cancel it through the durable command path."
      />
      <Card className="delay-search">
        <Form
          layout="vertical"
          onFinish={() => lookup.mutate(delayId)}
        >
          <Form.Item label="Delay ID" required>
            <Space.Compact block>
              <Input
                aria-label="Delay ID"
                value={delayId}
                onChange={(event) => setDelayId(event.target.value)}
                placeholder="01J..."
              />
              <Button
                type="primary"
                htmlType="submit"
                icon={<ClockCircleOutlined />}
                loading={lookup.isPending}
                disabled={!delayId.trim()}
              >
                Inspect
              </Button>
            </Space.Compact>
          </Form.Item>
        </Form>
        <MutationError error={lookup.error} />
      </Card>
      {delay && (
        <Card
          className="panel-card delay-result"
          title={
            <Space>
              <Typography.Text code>{delay.delayId}</Typography.Text>
              <Tag color={delay.status === "PENDING" ? "processing" : "default"}>
                {delay.status}
              </Tag>
            </Space>
          }
          extra={
            <Button
              danger
              icon={<StopOutlined />}
              disabled={delay.status !== "PENDING" || delay.cancelRequested}
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancel schedule
            </Button>
          }
        >
          {delay.cancelRequested && (
            <Alert
              showIcon
              type="success"
              message="Cancellation command accepted"
            />
          )}
          <MutationError error={cancel.error} />
          <Descriptions bordered column={{xs: 1, sm: 2}}>
            <Descriptions.Item label="Target topic">{delay.targetTopic}</Descriptions.Item>
            <Descriptions.Item label="Payload">{delay.payloadBytes} bytes</Descriptions.Item>
            <Descriptions.Item label="Due at">{delay.dueAt}</Descriptions.Item>
            <Descriptions.Item label="Created at">{delay.createdAt}</Descriptions.Item>
            <Descriptions.Item label="Fired at">{delay.firedAt ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Expires at">{delay.expireAt ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Loop interval">
              {delay.loopIntervalMs ? `${delay.loopIntervalMs} ms` : "One shot"}
            </Descriptions.Item>
            <Descriptions.Item label="Remaining">{delay.loopRemaining ?? "—"}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}
    </>
  );
}
