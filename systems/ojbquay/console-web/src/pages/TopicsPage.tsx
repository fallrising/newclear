import {ExperimentOutlined, PlusOutlined, ReloadOutlined} from "@ant-design/icons";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Radio,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {useState} from "react";
import {api} from "../api";
import {
  MutationError,
  PageHeader,
  QueryState,
  ResourceState,
  Version,
} from "../components";
import {textToBase64} from "../encoding";
import type {Topic, TopicSample} from "../types";

interface CreateTopic {
  name: string;
  partitions: number;
  replication: number;
  delayTopic: boolean;
  maxMessageBytes: number;
  retentionMs: number;
  produceQuotaTps: number;
  compression: string;
  remark?: string;
}

function TopicDetail({topic, close}: {topic: Topic; close: () => void}) {
  const [sampleCount, setSampleCount] = useState(10);
  const [redact, setRedact] = useState(true);
  const [cel, setCel] = useState("");
  const [samples, setSamples] = useState<TopicSample[]>([]);
  const [testOpen, setTestOpen] = useState(false);
  const sample = useMutation({
    mutationFn: () =>
      api<TopicSample[]>(
        `/api/v1/topics/${topic.id}/sample?n=${sampleCount}&redact=${redact}&cel=${encodeURIComponent(cel)}`,
      ),
    onSuccess: setSamples,
  });
  const send = useMutation({
    mutationFn: (values: {key?: string; body: string; partition?: number}) =>
      api<{partition: number; offset: number; timestamp: string}>(
        `/api/v1/topics/${topic.id}/test-message`,
        {
          method: "POST",
          body: JSON.stringify({
            key: values.key,
            valueBase64: textToBase64(values.body),
            tags: [],
            headers: {"x-ojbk-source": "console"},
            partition: values.partition,
          }),
        },
      ),
    onSuccess: () => setTestOpen(false),
  });
  return (
    <Drawer
      width={720}
      open
      onClose={close}
      title={
        <Space>
          {topic.name}
          <ResourceState enabled={topic.state === 1} />
        </Space>
      }
      extra={<Version value={topic.version} />}
    >
      <Tabs
        items={[
          {
            key: "details",
            label: "Configuration",
            children: (
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="Owner">{topic.owner}</Descriptions.Item>
                <Descriptions.Item label="Partitions">{topic.partitions}</Descriptions.Item>
                <Descriptions.Item label="Replication">{topic.replication}</Descriptions.Item>
                <Descriptions.Item label="Retention">{topic.retentionMs} ms</Descriptions.Item>
                <Descriptions.Item label="Compression">{topic.compression}</Descriptions.Item>
                <Descriptions.Item label="Delay enabled">
                  {topic.delayTopic ? "Yes" : "No"}
                </Descriptions.Item>
                <Descriptions.Item label="Produce token">
                  <Typography.Text copyable code>{topic.token}</Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            ),
          },
          {
            key: "messages",
            label: "Sample & test",
            children: (
              <Space direction="vertical" size="middle" className="full-width">
                <Card size="small" title="Inspect recent messages">
                  <Space wrap>
                    <InputNumber
                      aria-label="Sample count"
                      min={1}
                      max={100}
                      value={sampleCount}
                      onChange={(value) => setSampleCount(value ?? 10)}
                    />
                    <Input
                      aria-label="CEL expression"
                      placeholder="Optional CEL expression"
                      value={cel}
                      onChange={(event) => setCel(event.target.value)}
                    />
                    <Space>
                      <Switch
                        aria-label="Redact payload"
                        checked={redact}
                        onChange={setRedact}
                      />
                      Redact bodies
                    </Space>
                    <Button
                      icon={<ReloadOutlined />}
                      loading={sample.isPending}
                      onClick={() => sample.mutate()}
                    >
                      Load sample
                    </Button>
                    <Button
                      type="primary"
                      icon={<ExperimentOutlined />}
                      onClick={() => setTestOpen(true)}
                    >
                      Send test message
                    </Button>
                  </Space>
                </Card>
                <MutationError error={sample.error} />
                <List
                  dataSource={samples}
                  locale={{emptyText: "Load a bounded sample to inspect messages"}}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        title={
                          <Space>
                            <Tag>p{item.partition} / {item.offset}</Tag>
                            {item.celMatched && <Tag color="cyan">CEL match</Tag>}
                            {item.redacted && <Tag>redacted</Tag>}
                          </Space>
                        }
                        description={
                          item.redacted
                            ? "Payload hidden"
                            : <Typography.Text code>{item.valueBase64}</Typography.Text>
                        }
                      />
                    </List.Item>
                  )}
                />
                <Modal
                  title="Send test message"
                  open={testOpen}
                  footer={null}
                  destroyOnClose
                  onCancel={() => setTestOpen(false)}
                >
                  <Form layout="vertical" onFinish={(values) => send.mutate(values)}>
                    <Form.Item label="Key" name="key"><Input /></Form.Item>
                    <Form.Item
                      label="Message body"
                      name="body"
                      rules={[{required: true}]}
                    >
                      <Input.TextArea rows={6} />
                    </Form.Item>
                    <Form.Item label="Partition" name="partition">
                      <InputNumber min={0} max={topic.partitions - 1} />
                    </Form.Item>
                    <MutationError error={send.error} />
                    <Button type="primary" htmlType="submit" loading={send.isPending}>
                      Produce message
                    </Button>
                  </Form>
                </Modal>
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

export function TopicsPage() {
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Topic>();
  const topics = useQuery({
    queryKey: ["topics"],
    queryFn: () => api<Topic[]>("/api/v1/topics"),
  });
  const create = useMutation({
    mutationFn: (values: CreateTopic) =>
      api<Topic>("/api/v1/topics", {
        method: "POST",
        body: JSON.stringify({clusterId: 1, ...values}),
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      await client.invalidateQueries({queryKey: ["topics"]});
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="MESSAGE CONTRACTS"
        title="Topics"
        description="Provision streams, inspect bounded samples, and validate production."
        action={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Create topic
          </Button>
        }
      />
      <Card className="table-card">
        <QueryState
          loading={topics.isLoading}
          error={topics.error}
          empty={topics.data?.length === 0}
          retry={() => topics.refetch()}
        >
          <Table
            rowKey="id"
            dataSource={topics.data}
            pagination={false}
            scroll={{x: 700}}
            onRow={(record) => ({onClick: () => setSelected(record)})}
            columns={[
              {title: "Name", dataIndex: "name", render: (value) => <Typography.Text strong>{value}</Typography.Text>},
              {title: "Partitions", dataIndex: "partitions"},
              {title: "Owner", dataIndex: "owner"},
              {title: "State", dataIndex: "state", render: (value) => <ResourceState enabled={value === 1} />},
              {title: "Version", dataIndex: "version", render: (value) => <Version value={value} />},
            ]}
          />
        </QueryState>
      </Card>
      <Drawer
        title="Create topic"
        width={520}
        open={createOpen}
        destroyOnClose
        onClose={() => setCreateOpen(false)}
      >
        <Form<CreateTopic>
          layout="vertical"
          requiredMark="optional"
          initialValues={{
            partitions: 3,
            replication: 1,
            delayTopic: false,
            maxMessageBytes: 1_048_576,
            retentionMs: 604_800_000,
            produceQuotaTps: 1_000,
            compression: "zstd",
          }}
          onFinish={(values) => create.mutate(values)}
        >
          <Form.Item label="Topic name" name="name" rules={[{required: true, max: 128}]}>
            <Input placeholder="orders.created" />
          </Form.Item>
          <Space align="start" wrap>
            <Form.Item label="Partitions" name="partitions" rules={[{required: true}]}>
              <InputNumber min={1} max={1024} />
            </Form.Item>
            <Form.Item label="Replication" name="replication" rules={[{required: true}]}>
              <InputNumber min={1} max={7} />
            </Form.Item>
            <Form.Item label="Max TPS" name="produceQuotaTps" rules={[{required: true}]}>
              <InputNumber min={1} />
            </Form.Item>
          </Space>
          <Form.Item label="Compression" name="compression">
            <Radio.Group
              options={[
                {label: "Zstd", value: "zstd"},
                {label: "LZ4", value: "lz4"},
                {label: "None", value: "none"},
              ]}
            />
          </Form.Item>
          <Form.Item label="Retention (ms)" name="retentionMs">
            <InputNumber min={1} className="wide-input" />
          </Form.Item>
          <Form.Item label="Max message bytes" name="maxMessageBytes">
            <InputNumber min={1} max={4_194_304} className="wide-input" />
          </Form.Item>
          <Form.Item label="Enable delay scheduling" name="delayTopic" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Remark" name="remark"><Input.TextArea rows={3} /></Form.Item>
          <MutationError error={create.error} />
          <Button type="primary" htmlType="submit" loading={create.isPending}>
            Create topic
          </Button>
        </Form>
      </Drawer>
      {selected && <TopicDetail topic={selected} close={() => setSelected(undefined)} />}
    </>
  );
}
