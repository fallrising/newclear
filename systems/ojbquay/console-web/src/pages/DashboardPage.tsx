import {CheckCircleFilled, DatabaseOutlined, SendOutlined, TeamOutlined} from "@ant-design/icons";
import {useQuery} from "@tanstack/react-query";
import {Card, Col, Flex, List, Row, Space, Statistic, Tag, Typography} from "antd";
import * as echarts from "echarts";
import {useEffect, useRef} from "react";
import {api} from "../api";
import {useAuth} from "../auth";
import {PageHeader, QueryState} from "../components";
import type {
  Cluster,
  ClusterHealth,
  ConsumeGroup,
  GroupTopicProgress,
  Subscription,
  Topic,
} from "../types";

function DeliveryChart({
  topics,
  groups,
  subscriptions,
}: {
  topics: number;
  groups: number;
  subscriptions: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      tooltip: {},
      grid: {left: 20, right: 10, top: 10, bottom: 24, containLabel: true},
      xAxis: {
        type: "category",
        data: ["Topics", "Groups", "Subscriptions"],
        axisLine: {lineStyle: {color: "#ccd5d8"}},
      },
      yAxis: {type: "value", minInterval: 1, splitLine: {lineStyle: {color: "#edf0ef"}}},
      series: [{
        type: "bar",
        data: [topics, groups, subscriptions],
        barWidth: 34,
        itemStyle: {color: "#087f8c", borderRadius: [6, 6, 0, 0]},
      }],
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [groups, subscriptions, topics]);
  return <div ref={ref} className="chart" role="img" aria-label="Active resource chart" />;
}

export function DashboardPage() {
  const {actor} = useAuth();
  const operator = actor?.roles.some((role) => ["OPS", "ADMIN"].includes(role)) ?? false;
  const topics = useQuery({
    queryKey: ["topics"],
    queryFn: () => api<Topic[]>("/api/v1/topics"),
  });
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api<ConsumeGroup[]>("/api/v1/groups"),
  });
  const subscriptions = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => api<Subscription[]>("/api/v1/subscriptions"),
  });
  const clusters = useQuery({
    queryKey: ["clusters"],
    queryFn: () => api<Cluster[]>("/api/v1/clusters"),
    enabled: operator,
  });
  const clusterHealth = useQuery({
    queryKey: ["cluster-health", clusters.data?.[0]?.id],
    queryFn: () =>
      api<ClusterHealth>(`/api/v1/clusters/${clusters.data![0].id}/health`),
    enabled: operator && Boolean(clusters.data?.length),
  });
  const progress = useQuery({
    queryKey: ["dashboard-progress", groups.data?.map((group) => group.id)],
    queryFn: async () => {
      const results = await Promise.allSettled(
        (groups.data ?? []).map((group) =>
          api<GroupTopicProgress[]>(`/api/v1/groups/${group.id}/progress`)),
      );
      return results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []);
    },
    enabled: Boolean(groups.data?.length),
  });
  const loading = topics.isLoading || groups.isLoading || subscriptions.isLoading;
  const error = topics.error || groups.error || subscriptions.error;
  const activeTopics = topics.data?.filter((item) => item.state === 1).length ?? 0;
  const activeGroups = groups.data?.filter((item) => item.state === 1).length ?? 0;
  const activeSubscriptions =
    subscriptions.data?.filter((item) => item.state === 1).length ?? 0;
  const totalSubscriptions = subscriptions.data?.length ?? 0;
  const deliveryReadiness =
    totalSubscriptions === 0
      ? 0
      : Math.round((activeSubscriptions / totalSubscriptions) * 100);
  const lagging = (progress.data ?? [])
    .flatMap((item) =>
      item.partitions.map((partition) => ({...partition, topic: item.topic})))
    .filter((partition) => partition.lag > 0)
    .sort((left, right) => right.lag - left.lag);
  const topTopics = [...(topics.data ?? [])]
    .sort((left, right) => right.produceQuotaTps - left.produceQuotaTps)
    .slice(0, 5);
  return (
    <>
      <PageHeader
        eyebrow="LIVE OPERATIONS"
        title="System overview"
        description="Desired resources and delivery health across your messaging estate."
      />
      <QueryState loading={loading} error={error}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card className="metric-card">
              <Statistic title="Active topics" value={activeTopics} prefix={<SendOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card className="metric-card">
              <Statistic title="Consumer groups" value={activeGroups} prefix={<TeamOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card className="metric-card">
              <Statistic title="Subscriptions" value={activeSubscriptions} prefix={<DatabaseOutlined />} />
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Card title="Active resources" className="panel-card">
              <DeliveryChart
                topics={activeTopics}
                groups={activeGroups}
                subscriptions={activeSubscriptions}
              />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="Delivery readiness" className="panel-card signal-card">
              <Flex vertical align="center" justify="center" gap={14}>
                <CheckCircleFilled className="signal-icon" />
                <Typography.Title level={2}>{deliveryReadiness}%</Typography.Title>
                <Typography.Text strong>
                  {activeSubscriptions}/{totalSubscriptions} desired paths active
                </Typography.Text>
                <Typography.Text type="secondary">
                  Runtime success and latency are measured in Grafana.
                </Typography.Text>
                <Space className="signal-foot">
                  <span className="pulse" />
                  Desired configuration published
                </Space>
              </Flex>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="Kafka control plane" className="panel-card compact-panel">
              {operator ? (
                <Space direction="vertical" size="middle">
                  <Tag color={clusterHealth.data?.status === "UP" ? "success" : "default"}>
                    {clusterHealth.isLoading ? "Probing" : clusterHealth.data?.status ?? "Unavailable"}
                  </Tag>
                  <Typography.Text strong>
                    {clusters.data?.[0]?.name ?? "No default cluster"}
                  </Typography.Text>
                  {clusterHealth.data && (
                    <Typography.Text type="secondary">
                      {clusterHealth.data.nodeCount} broker nodes · controller{" "}
                      {clusterHealth.data.controllerId}
                    </Typography.Text>
                  )}
                </Space>
              ) : (
                <Typography.Text type="secondary">
                  Cluster probes are available to OPS and ADMIN.
                </Typography.Text>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="Lag watch" className="panel-card compact-panel">
              {lagging.length ? (
                <List
                  size="small"
                  dataSource={lagging.slice(0, 5)}
                  renderItem={(item) => (
                    <List.Item>
                      <Typography.Text>{item.topic} / p{item.partition}</Typography.Text>
                      <Tag color="orange">{item.lag}</Tag>
                    </List.Item>
                  )}
                />
              ) : (
                <Typography.Text type="secondary">
                  No classic ordered partition lag is currently visible.
                </Typography.Text>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="Provisioned topic capacity" className="panel-card compact-panel">
              <List
                size="small"
                dataSource={topTopics}
                locale={{emptyText: "No topics provisioned"}}
                renderItem={(item) => (
                  <List.Item>
                    <Typography.Text>{item.name}</Typography.Text>
                    <Typography.Text type="secondary">
                      {item.produceQuotaTps.toLocaleString()} msg/s
                    </Typography.Text>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      </QueryState>
    </>
  );
}
