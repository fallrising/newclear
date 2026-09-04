import {PlusOutlined, ReloadOutlined, WarningOutlined} from "@ant-design/icons";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
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
import type {ConsumeGroup, GroupTopicProgress, Topic} from "../types";

function GroupDetail({group, close}: {group: ConsumeGroup; close: () => void}) {
  const [resetOpen, setResetOpen] = useState(false);
  const topics = useQuery({
    queryKey: ["topics"],
    queryFn: () => api<Topic[]>("/api/v1/topics"),
  });
  const progress = useQuery({
    queryKey: ["group-progress", group.id],
    queryFn: () => api<GroupTopicProgress[]>(`/api/v1/groups/${group.id}/progress`),
  });
  const reset = useMutation({
    mutationFn: (values: {topicId: number; mode: string; value: number}) =>
      api<{group: string; topic: string; offsets: Array<{partition: number; offset: number}>}>(
        `/api/v1/groups/${group.id}/reset-offset`,
        {method: "POST", body: JSON.stringify(values)},
      ),
    onSuccess: async () => {
      setResetOpen(false);
      await progress.refetch();
    },
  });
  const partitions = progress.data?.flatMap((item) =>
    item.partitions.map((partition) => ({
      ...partition,
      topic: item.topic,
      mode: item.mode,
    })),
  );
  return (
    <Drawer
      open
      width={800}
      onClose={close}
      title={
        <Space>
          {group.name}
          <ResourceState enabled={group.state === 1} />
        </Space>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => progress.refetch()}>
            Refresh
          </Button>
          <Button type="primary" danger onClick={() => setResetOpen(true)}>
            Reset offsets
          </Button>
        </Space>
      }
    >
      <Descriptions column={1} bordered size="small" className="detail-block">
        <Descriptions.Item label="Owner">{group.owner}</Descriptions.Item>
        <Descriptions.Item label="Desired config"><Version value={group.version} /></Descriptions.Item>
        <Descriptions.Item label="Consumer token">
          <Typography.Text copyable code>{group.token}</Typography.Text>
        </Descriptions.Item>
      </Descriptions>
      <Typography.Title level={4}>Partition progress</Typography.Title>
      <QueryState
        loading={progress.isLoading}
        error={progress.error}
        empty={!partitions?.length && !progress.data?.some((item) => item.unsupportedReason)}
      >
        <>
          {progress.data?.filter((item) => item.unsupportedReason).map((item) => (
            <Alert
              key={item.topic}
              showIcon
              type="info"
              message={`${item.topic}: Share progress unavailable`}
              description={item.unsupportedReason}
            />
          ))}
          <Table
            rowKey={(item) => `${item.topic}-${item.partition}`}
            dataSource={partitions}
            pagination={false}
            scroll={{x: 650}}
            columns={[
              {title: "Topic", dataIndex: "topic"},
              {title: "Partition", dataIndex: "partition"},
              {title: "Committed", dataIndex: "committedOffset", render: (value) => value ?? "—"},
              {title: "End", dataIndex: "endOffset"},
              {
                title: "Lag",
                dataIndex: "lag",
                render: (value) => <Tag color={value > 0 ? "orange" : "success"}>{value}</Tag>,
              },
            ]}
          />
        </>
      </QueryState>
      <Modal
        title="Reset consumer offsets"
        open={resetOpen}
        footer={null}
        destroyOnClose
        onCancel={() => setResetOpen(false)}
      >
        <Alert
          showIcon
          type="warning"
          icon={<WarningOutlined />}
          message="Delivery will pause during this operation"
          description="The broker group must become empty before any offsets are altered. Share and pull subscriptions cannot be reset."
        />
        <Form
          layout="vertical"
          className="modal-form"
          initialValues={{mode: "EARLIEST", value: 0}}
          onFinish={(values) => reset.mutate(values)}
        >
          <Form.Item label="Topic" name="topicId" rules={[{required: true}]}>
            <Select
              options={topics.data?.map((topic) => ({label: topic.name, value: topic.id}))}
            />
          </Form.Item>
          <Form.Item label="Reset mode" name="mode" rules={[{required: true}]}>
            <Select
              options={[
                {label: "Exact offset", value: "OFFSET"},
                {label: "At timestamp", value: "TIMESTAMP"},
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Offset or epoch milliseconds"
            name="value"
            tooltip="Used for exact offset and timestamp modes"
          >
            <InputNumber min={0} className="wide-input" />
          </Form.Item>
          <MutationError error={reset.error} />
          <Button type="primary" danger htmlType="submit" loading={reset.isPending}>
            Pause and reset
          </Button>
        </Form>
      </Modal>
    </Drawer>
  );
}

export function GroupsPage() {
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<ConsumeGroup>();
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api<ConsumeGroup[]>("/api/v1/groups"),
  });
  const create = useMutation({
    mutationFn: (values: {name: string; remark?: string}) =>
      api<ConsumeGroup>("/api/v1/groups", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      await client.invalidateQueries({queryKey: ["groups"]});
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="CONSUMER OWNERSHIP"
        title="Consumer groups"
        description="Manage credentials, watch committed progress, and perform guarded resets."
        action={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Create group
          </Button>
        }
      />
      <Card className="table-card">
        <QueryState
          loading={groups.isLoading}
          error={groups.error}
          empty={groups.data?.length === 0}
          retry={() => groups.refetch()}
        >
          <Table
            rowKey="id"
            dataSource={groups.data}
            pagination={false}
            onRow={(record) => ({onClick: () => setSelected(record)})}
            columns={[
              {title: "Name", dataIndex: "name", render: (value) => <Typography.Text strong>{value}</Typography.Text>},
              {title: "Owner", dataIndex: "owner"},
              {title: "State", dataIndex: "state", render: (value) => <ResourceState enabled={value === 1} />},
              {title: "Version", dataIndex: "version", render: (value) => <Version value={value} />},
            ]}
          />
        </QueryState>
      </Card>
      <Drawer
        title="Create consumer group"
        width={480}
        open={createOpen}
        destroyOnClose
        onClose={() => setCreateOpen(false)}
      >
        <Form layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item label="Group name" name="name" rules={[{required: true, max: 128}]}>
            <Input placeholder="order-fulfilment" />
          </Form.Item>
          <Form.Item label="Remark" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
          <MutationError error={create.error} />
          <Button type="primary" htmlType="submit" loading={create.isPending}>
            Create group
          </Button>
        </Form>
      </Drawer>
      {selected && <GroupDetail group={selected} close={() => setSelected(undefined)} />}
    </>
  );
}
