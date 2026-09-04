import {PlusOutlined, ReloadOutlined} from "@ant-design/icons";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {useState} from "react";
import {useParams} from "react-router";
import {api} from "../api";
import {MutationError, PageHeader, QueryState} from "../components";
import type {AuditPage, Cluster, ClusterHealth, User} from "../types";

function Clusters() {
  const clusters = useQuery({
    queryKey: ["clusters"],
    queryFn: () => api<Cluster[]>("/api/v1/clusters"),
  });
  const health = useMutation({
    mutationFn: (id: number) => api<ClusterHealth>(`/api/v1/clusters/${id}/health`),
  });
  return (
    <Card className="table-card">
      <QueryState loading={clusters.isLoading} error={clusters.error} empty={!clusters.data?.length}>
        <Table
          rowKey="id"
          dataSource={clusters.data}
          pagination={false}
          scroll={{x: 700}}
          columns={[
            {title: "Cluster", dataIndex: "name", render: (value, record) => (
              <Space><Typography.Text strong>{value}</Typography.Text>{record.defaultCluster && <Tag>default</Tag>}</Space>
            )},
            {title: "Bootstrap", dataIndex: "bootstrapServers"},
            {title: "Created", dataIndex: "createdAt"},
            {title: "", render: (_, record) => (
              <Button icon={<ReloadOutlined />} loading={health.isPending} onClick={() => health.mutate(record.id)}>
                Probe
              </Button>
            )},
          ]}
        />
      </QueryState>
      {health.data && (
        <Alert
          className="drawer-action"
          showIcon
          type={health.data.status === "UP" ? "success" : "error"}
          message={health.data.status === "UP" ? "Kafka cluster is healthy" : "Kafka probe failed"}
          description={`${health.data.nodeCount} nodes · controller ${health.data.controllerId} · cluster ${health.data.clusterId}`}
        />
      )}
      <MutationError error={health.error} />
    </Card>
  );
}

function Users() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/api/v1/admin/users"),
  });
  const create = useMutation({
    mutationFn: (values: {username: string; password: string; role: string}) =>
      api<User>("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      setOpen(false);
      await client.invalidateQueries({queryKey: ["users"]});
    },
  });
  return (
    <>
      <Card
        className="table-card"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Create user</Button>}
      >
        <QueryState loading={users.isLoading} error={users.error} empty={!users.data?.length}>
          <Table
            rowKey="id"
            dataSource={users.data}
            pagination={false}
            columns={[
              {title: "Username", dataIndex: "username"},
              {title: "Role", dataIndex: "role", render: (value) => <Tag color="cyan">{value}</Tag>},
              {title: "State", dataIndex: "enabled", render: (value) => <Tag color={value ? "success" : "default"}>{value ? "Enabled" : "Disabled"}</Tag>},
              {title: "Created", dataIndex: "createdAt"},
            ]}
          />
        </QueryState>
      </Card>
      <Drawer title="Create user" open={open} width={480} destroyOnClose onClose={() => setOpen(false)}>
        <Form layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item label="Username" name="username" rules={[{required: true, max: 64}]}><Input /></Form.Item>
          <Form.Item label="Initial password" name="password" rules={[{required: true, min: 12, max: 128}]}><Input.Password /></Form.Item>
          <Form.Item label="Role" name="role" initialValue="USER"><Select options={[{value: "USER"}, {value: "OPS"}, {value: "ADMIN"}]} /></Form.Item>
          <MutationError error={create.error} />
          <Button type="primary" htmlType="submit" loading={create.isPending}>Create user</Button>
        </Form>
      </Drawer>
    </>
  );
}

function Audit() {
  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<AuditPage>("/api/v1/audit?page=0&size=100"),
  });
  return (
    <Card className="table-card">
      <QueryState loading={audit.isLoading} error={audit.error} empty={!audit.data?.items.length}>
        <Table
          rowKey="id"
          dataSource={audit.data?.items}
          pagination={{pageSize: 25}}
          scroll={{x: 800}}
          columns={[
            {title: "Time", dataIndex: "at"},
            {title: "Actor", dataIndex: "actor"},
            {title: "Action", dataIndex: "action", render: (value) => <Tag>{value}</Tag>},
            {title: "Entity", render: (_, record) => `${record.entity} / ${record.entityId}`},
            {title: "Detail", dataIndex: "detail", render: (value) => <Typography.Text code>{JSON.stringify(value)}</Typography.Text>},
          ]}
        />
      </QueryState>
    </Card>
  );
}

export function AdminPage() {
  const {section = "clusters"} = useParams();
  const title = section === "users" ? "Users" : section === "audit" ? "Audit trail" : "Kafka clusters";
  const description =
    section === "users"
      ? "Provision role-scoped access without exposing stored credentials."
      : section === "audit"
        ? "Trace control-plane mutations and operational decisions."
        : "Inspect configured brokers and run bounded health probes.";
  return (
    <>
      <PageHeader eyebrow="PLATFORM ADMINISTRATION" title={title} description={description} />
      {section === "users" ? <Users /> : section === "audit" ? <Audit /> : <Clusters />}
    </>
  );
}
