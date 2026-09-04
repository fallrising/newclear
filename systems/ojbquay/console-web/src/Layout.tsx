import {
  ApartmentOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SendOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {Avatar, Button, Layout, Menu, Space, Tag, Typography} from "antd";
import type {ItemType} from "antd/es/menu/interface";
import {useMemo} from "react";
import {Outlet, useLocation, useNavigate} from "react-router";
import {useAuth} from "./auth";
import {useUiStore} from "./store";

const {Header, Content, Sider} = Layout;

export function ConsoleLayout() {
  const {actor, logout} = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const collapsed = useUiStore((state) => state.collapsed);
  const setCollapsed = useUiStore((state) => state.setCollapsed);
  const operator = actor?.roles.some((role) =>
    ["ADMIN", "OPS"].includes(role),
  );
  const admin = actor?.roles.includes("ADMIN");
  const items = useMemo<ItemType[]>(
    () => [
      {key: "/dashboard", icon: <DashboardOutlined />, label: "Overview"},
      {key: "/topics", icon: <SendOutlined />, label: "Topics"},
      {key: "/groups", icon: <TeamOutlined />, label: "Consumer groups"},
      {
        key: "/subscriptions",
        icon: <ApartmentOutlined />,
        label: "Subscriptions",
      },
      {key: "/delay", icon: <ClockCircleOutlined />, label: "Delay"},
      ...(operator
        ? [
            {type: "divider" as const},
            {
              key: "/admin/clusters",
              icon: <CloudServerOutlined />,
              label: "Clusters",
            },
            {
              key: "/admin/audit",
              icon: <AuditOutlined />,
              label: "Audit",
            },
          ]
        : []),
      ...(admin
        ? [
            {
              key: "/admin/users",
              icon: <UserOutlined />,
              label: "Users",
            },
          ]
        : []),
    ],
    [admin, operator],
  );
  const selected =
    items
      .filter((item): item is Exclude<ItemType, null> => Boolean(item))
      .map((item) => ("key" in item ? String(item.key) : ""))
      .filter((key) => key && location.pathname.startsWith(key))
      .sort((a, b) => b.length - a.length)[0] ?? "/dashboard";

  return (
    <Layout className="app-shell">
      <Sider
        className="app-sider"
        width={248}
        collapsedWidth={72}
        collapsible
        trigger={null}
        collapsed={collapsed}
        breakpoint="lg"
        onBreakpoint={setCollapsed}
      >
        <button
          className="brand"
          aria-label="Go to dashboard"
          onClick={() => navigate("/dashboard")}
        >
          <span className="brand-mark">OQ</span>
          {!collapsed && (
            <span>
              <strong>ojbquay</strong>
              <small>message operations</small>
            </span>
          )}
        </button>
        <Menu
          theme="dark"
          mode="inline"
          items={items}
          selectedKeys={[selected]}
          onClick={({key}) => navigate(key)}
        />
        {!collapsed && (
          <div className="sider-foot">
            <span className="pulse" />
            Config bus connected
          </div>
        )}
      </Sider>
      <Layout>
        <Header className="app-header">
          <Button
            type="text"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <div className="header-spacer" />
          <Space>
            <Tag color="cyan">{actor?.roles[0]}</Tag>
            <Avatar size="small">{actor?.username.slice(0, 1).toUpperCase()}</Avatar>
            <Typography.Text>{actor?.username}</Typography.Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Logout
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
