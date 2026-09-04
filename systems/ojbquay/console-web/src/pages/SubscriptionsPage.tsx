import {
  ApartmentOutlined,
  DeleteOutlined,
  InboxOutlined,
  PlusOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Radio,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {useMemo, useState} from "react";
import {api} from "../api";
import {
  MutationError,
  PageHeader,
  QueryState,
  ResourceState,
  Version,
} from "../components";
import {base64ToText, textToBase64} from "../encoding";
import type {
  ConsumeGroup,
  DlqRecord,
  Preview,
  Subscription,
  Topic,
} from "../types";

interface WizardValues {
  groupId: number;
  topicId: number;
  mode: "PUSH" | "PULL";
  concurrency: number;
  maxTps: number;
  urls?: string;
  method?: "POST" | "GET";
  timeoutMs?: number;
  retryIntervals?: string;
  maxBatch?: number;
  ackTimeoutMs?: number;
  maxRetry?: number;
  ordered: boolean;
  filterCel?: string;
  tags?: string;
  transit?: string;
  shadowTraffic: boolean;
  dlqEnabled: boolean;
  sampleBody?: string;
  sampleTags?: string;
  sampleShadow?: boolean;
}

function csv(value?: string): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

export function subscriptionSpec(values: WizardValues): Record<string, unknown> {
  const common = {
    mode: values.mode,
    concurrency: values.concurrency,
    maxTps: values.maxTps,
    filterCel: values.filterCel ?? "",
    tags: csv(values.tags),
    transit: values.transit?.trim() ? JSON.parse(values.transit) : {},
    ordered: values.mode === "PUSH" && values.ordered,
    dlqEnabled: values.dlqEnabled,
    shadowTraffic: values.shadowTraffic,
  };
  if (values.mode === "PULL") {
    return {
      ...common,
      pull: {
        maxBatch: values.maxBatch,
        ackTimeoutMs: values.ackTimeoutMs,
        maxRetry: values.maxRetry,
      },
    };
  }
  return {
    ...common,
    ...(values.ordered ? {orderKeySource: "KEY", orderKeyExpr: ""} : {}),
    push: {
      urls: csv(values.urls),
      method: values.method,
      timeoutMs: values.timeoutMs,
      retryIntervalsMs: csv(values.retryIntervals).map(Number),
      headers: {"x-ojbk-subscription": "ojbquay"},
    },
  };
}

function DlqBrowser({subscription, close}: {subscription: Subscription; close: () => void}) {
  const [selected, setSelected] = useState<React.Key[]>([]);
  const records = useQuery({
    queryKey: ["dlq", subscription.id],
    queryFn: () =>
      api<DlqRecord[]>(`/api/v1/subscriptions/${subscription.id}/dlq?n=50`),
  });
  const replay = useMutation({
    mutationFn: () =>
      api<{replayed: number}>(`/api/v1/subscriptions/${subscription.id}/dlq/replay`, {
        method: "POST",
        body: JSON.stringify({
          records: selected.map((key) => {
            const [partition, offset] = String(key).split(":").map(Number);
            return {partition, offset};
          }),
        }),
      }),
    onSuccess: () => setSelected([]),
  });
  return (
    <Drawer title="Dead letters" open width={900} onClose={close}>
      <Alert
        className="detail-block"
        showIcon
        type="info"
        message="Payloads are shown as Base64"
        description="Replay is intentionally at-least-once and may produce duplicates."
      />
      <MutationError error={replay.error} />
      <Table
        rowKey={(record) => `${record.partition}:${record.offset}`}
        dataSource={records.data}
        loading={records.isLoading}
        rowSelection={{selectedRowKeys: selected, onChange: setSelected}}
        pagination={false}
        scroll={{x: 800}}
        columns={[
          {title: "Partition", dataIndex: "partition"},
          {title: "Offset", dataIndex: "offset"},
          {title: "Timestamp", dataIndex: "timestamp"},
          {
            title: "Payload",
            dataIndex: "valueBase64",
            ellipsis: true,
            render: (value) => <Typography.Text code copyable>{value}</Typography.Text>,
          },
        ]}
      />
      <Button
        className="drawer-action"
        type="primary"
        icon={<RocketOutlined />}
        disabled={!selected.length}
        loading={replay.isPending}
        onClick={() => replay.mutate()}
      >
        Replay selected ({selected.length})
      </Button>
    </Drawer>
  );
}

export function SubscriptionWizard({
  open,
  close,
}: {
  open: boolean;
  close: () => void;
}) {
  const [form] = Form.useForm<WizardValues>();
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [previewResult, setPreviewResult] = useState<Preview>();
  const mode = Form.useWatch("mode", form) ?? "PUSH";
  const topics = useQuery({
    queryKey: ["topics"],
    queryFn: () => api<Topic[]>("/api/v1/topics"),
    enabled: open,
  });
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api<ConsumeGroup[]>("/api/v1/groups"),
    enabled: open,
  });
  const preview = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields();
      return api<Preview>("/api/v1/subscriptions/preview", {
        method: "POST",
        body: JSON.stringify({
          spec: subscriptionSpec(values),
          sampleMessage: {
            key: "preview-key",
            valueBase64: textToBase64(values.sampleBody ?? "{}"),
            tags: csv(values.sampleTags),
            headers: values.sampleShadow ? {"x-ojbk-shadow": "1"} : {},
          },
        }),
      });
    },
    onSuccess: setPreviewResult,
  });
  const create = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields();
      return api<Subscription>("/api/v1/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          groupId: values.groupId,
          topicId: values.topicId,
          spec: subscriptionSpec(values),
        }),
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({queryKey: ["subscriptions"]});
      form.resetFields();
      setStep(0);
      setPreviewResult(undefined);
      close();
    },
  });
  const next = async () => {
    const fields: Array<Array<keyof WizardValues>> = [
      ["topicId", "groupId", "mode"],
      mode === "PUSH"
        ? ["concurrency", "maxTps", "urls", "method", "timeoutMs", "retryIntervals"]
        : ["concurrency", "maxTps", "maxBatch", "ackTimeoutMs", "maxRetry"],
      ["transit"],
    ];
    await form.validateFields(fields[step]);
    setStep((value) => value + 1);
  };
  return (
    <Drawer
      title="Create subscription"
      open={open}
      width={720}
      destroyOnClose
      onClose={close}
    >
      <Steps
        current={step}
        responsive={false}
        items={[
          {title: "Route"},
          {title: "Delivery"},
          {title: "Policy"},
          {title: "Preview"},
        ]}
      />
      <Form<WizardValues>
        form={form}
        className="wizard-form"
        layout="vertical"
        initialValues={{
          mode: "PUSH",
          concurrency: 16,
          maxTps: 1_000,
          method: "POST",
          timeoutMs: 5_000,
          retryIntervals: "150, 300, 600",
          maxBatch: 16,
          ackTimeoutMs: 30_000,
          maxRetry: 3,
          ordered: false,
          shadowTraffic: false,
          dlqEnabled: true,
          transit: "{}",
          sampleBody: "{\"event\":\"preview\"}",
        }}
      >
        <section hidden={step !== 0}>
          <Form.Item label="Topic" name="topicId" rules={[{required: true}]}>
            <Select
              placeholder="Select a topic"
              options={topics.data?.map((topic) => ({label: topic.name, value: topic.id}))}
            />
          </Form.Item>
          <Form.Item label="Consumer group" name="groupId" rules={[{required: true}]}>
            <Select
              placeholder="Select a group"
              options={groups.data?.map((group) => ({label: group.name, value: group.id}))}
            />
          </Form.Item>
          <Form.Item label="Delivery mode" name="mode">
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="PUSH">HTTP push</Radio.Button>
              <Radio.Button value="PULL">SDK pull</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </section>
        <section hidden={step !== 1}>
          <Space align="start" wrap>
            <Form.Item label="Concurrency" name="concurrency" rules={[{required: true}]}>
              <InputNumber min={1} max={500} />
            </Form.Item>
            <Form.Item label="Max TPS" name="maxTps" rules={[{required: true}]}>
              <InputNumber min={1} max={1_000_000} />
            </Form.Item>
          </Space>
          {mode === "PUSH" ? (
            <>
              <Form.Item label="HTTP endpoints" name="urls" rules={[{required: true}]}>
                <Input placeholder="https://service.example/events" />
              </Form.Item>
              <Space align="start" wrap>
                <Form.Item label="Method" name="method"><Select options={[{value: "POST"}, {value: "GET"}]} /></Form.Item>
                <Form.Item label="Timeout (ms)" name="timeoutMs"><InputNumber min={1} max={60_000} /></Form.Item>
              </Space>
              <Form.Item
                label="Retry intervals (ms)"
                name="retryIntervals"
                tooltip="Comma separated. A trailing -1 repeats the previous interval."
                rules={[{required: true}]}
              >
                <Input />
              </Form.Item>
              <Form.Item label="Ordered delivery" name="ordered" valuePropName="checked">
                <Switch />
              </Form.Item>
            </>
          ) : (
            <Space align="start" wrap>
              <Form.Item label="Max batch" name="maxBatch"><InputNumber min={1} max={500} /></Form.Item>
              <Form.Item label="Ack timeout (ms)" name="ackTimeoutMs"><InputNumber min={1_000} max={300_000} /></Form.Item>
              <Form.Item label="Max retries" name="maxRetry"><InputNumber min={0} max={100} /></Form.Item>
            </Space>
          )}
        </section>
        <section hidden={step !== 2}>
          <Form.Item label="Required tags" name="tags" tooltip="Comma separated, all must match">
            <Input placeholder="paid, priority" />
          </Form.Item>
          <Form.Item label="CEL filter" name="filterCel">
            <Input placeholder="body.amount > 0" />
          </Form.Item>
          <Form.Item
            label="Transit mapping (JSON)"
            name="transit"
            rules={[{
              validator: (_, value) => {
                try {
                  if (value) JSON.parse(value);
                  return Promise.resolve();
                } catch {
                  return Promise.reject(new Error("Enter a JSON object"));
                }
              },
            }]}
          >
            <Input.TextArea rows={4} placeholder={'{"$.userId":"$.user.id"}'} />
          </Form.Item>
          <Form.Item name="shadowTraffic" valuePropName="checked">
            <Checkbox>Accept shadow traffic</Checkbox>
          </Form.Item>
          <Form.Item name="dlqEnabled" valuePropName="checked">
            <Checkbox>Write exhausted messages to the DLQ</Checkbox>
          </Form.Item>
        </section>
        <section hidden={step !== 3}>
          <Alert
            showIcon
            type="info"
            message="Preview is side-effect free"
            description="The same tag, shadow, CEL, and transit logic runs without producing a broker record."
          />
          <Form.Item label="Sample JSON body" name="sampleBody" rules={[{required: true}]}>
            <Input.TextArea rows={5} />
          </Form.Item>
          <Form.Item label="Sample tags" name="sampleTags"><Input /></Form.Item>
          <Form.Item name="sampleShadow" valuePropName="checked">
            <Checkbox>Mark the sample as shadow traffic</Checkbox>
          </Form.Item>
          <Button
            icon={<InboxOutlined />}
            loading={preview.isPending}
            onClick={() => preview.mutate()}
          >
            Run preview
          </Button>
          {previewResult && (
            <Card size="small" className="preview-result">
              <Space direction="vertical">
                <Tag color={previewResult.action === "DELIVER" ? "success" : "warning"}>
                  {previewResult.action}
                </Tag>
                {previewResult.reason && <Typography.Text>Reason: {previewResult.reason}</Typography.Text>}
                {previewResult.valueBase64 && (
                  <Typography.Text code>
                    {base64ToText(previewResult.valueBase64)}
                  </Typography.Text>
                )}
              </Space>
            </Card>
          )}
          <MutationError error={preview.error} />
          <MutationError error={create.error} />
        </section>
      </Form>
      <Space className="wizard-actions">
        {step > 0 && <Button onClick={() => setStep((value) => value - 1)}>Back</Button>}
        {step < 3 ? (
          <Button type="primary" onClick={next}>Continue</Button>
        ) : (
          <Button
            type="primary"
            icon={<ApartmentOutlined />}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Create subscription
          </Button>
        )}
      </Space>
    </Drawer>
  );
}

export function SubscriptionsPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [dlq, setDlq] = useState<Subscription>();
  const subscriptions = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => api<Subscription[]>("/api/v1/subscriptions"),
  });
  const topics = useQuery({
    queryKey: ["topics"],
    queryFn: () => api<Topic[]>("/api/v1/topics"),
  });
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api<ConsumeGroup[]>("/api/v1/groups"),
  });
  const topicNames = useMemo(
    () => new Map(topics.data?.map((item) => [item.id, item.name])),
    [topics.data],
  );
  const groupNames = useMemo(
    () => new Map(groups.data?.map((item) => [item.id, item.name])),
    [groups.data],
  );
  return (
    <>
      <PageHeader
        eyebrow="DELIVERY TOPOLOGY"
        title="Subscriptions"
        description="Connect topics to consumers with explicit delivery and transformation policy."
        action={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>
            Create subscription
          </Button>
        }
      />
      <Card className="table-card">
        <QueryState
          loading={subscriptions.isLoading}
          error={subscriptions.error}
          empty={subscriptions.data?.length === 0}
          retry={() => subscriptions.refetch()}
        >
          <Table
            rowKey="id"
            dataSource={subscriptions.data}
            pagination={false}
            scroll={{x: 760}}
            columns={[
              {title: "Topic", dataIndex: "topicId", render: (value) => topicNames.get(value) ?? `#${value}`},
              {title: "Group", dataIndex: "groupId", render: (value) => groupNames.get(value) ?? `#${value}`},
              {title: "Mode", dataIndex: "spec", render: (value) => <Tag color="cyan">{String(value.mode)}</Tag>},
              {title: "State", dataIndex: "state", render: (value) => <ResourceState enabled={value === 1} />},
              {title: "Version", dataIndex: "version", render: (value) => <Version value={value} />},
              {
                title: "",
                render: (_, record) => (
                  <Button
                    type="link"
                    icon={<DeleteOutlined />}
                    onClick={() => setDlq(record)}
                  >
                    DLQ
                  </Button>
                ),
              },
            ]}
          />
        </QueryState>
      </Card>
      <SubscriptionWizard open={wizardOpen} close={() => setWizardOpen(false)} />
      {dlq && <DlqBrowser subscription={dlq} close={() => setDlq(undefined)} />}
    </>
  );
}
