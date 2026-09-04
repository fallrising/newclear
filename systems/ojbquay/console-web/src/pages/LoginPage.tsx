import {LockOutlined, UserOutlined} from "@ant-design/icons";
import {Alert, Button, Form, Input, Typography} from "antd";
import {useState} from "react";
import {Navigate, useLocation, useNavigate} from "react-router";
import {useAuth} from "../auth";

export function LoginPage() {
  const {actor, login} = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string>();
  if (actor) {
    return <Navigate to="/dashboard" replace />;
  }
  return (
    <main className="login-page">
      <section className="login-story" aria-hidden="true">
        <span className="story-orbit story-orbit-one" />
        <span className="story-orbit story-orbit-two" />
        <div>
          <div className="story-mark">OQ</div>
          <Typography.Title>Messages in motion.<br />Operations in focus.</Typography.Title>
          <Typography.Paragraph>
            One control plane for topics, delivery, delays, and every consumer.
          </Typography.Paragraph>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <Typography.Text className="eyebrow">CONTROL PLANE</Typography.Text>
          <Typography.Title level={2}>Welcome back</Typography.Title>
          <Typography.Paragraph type="secondary">
            Sign in with your ojbquay account.
          </Typography.Paragraph>
          <Form
            layout="vertical"
            requiredMark={false}
            onFinish={async (values: {username: string; password: string}) => {
              setError(undefined);
              try {
                await login(values.username, values.password);
                const from = (
                  location.state as {from?: {pathname?: string}} | null
                )?.from?.pathname;
                navigate(from && from !== "/login" ? from : "/dashboard", {
                  replace: true,
                });
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Login failed");
              }
            }}
          >
            <Form.Item
              label="Username"
              name="username"
              rules={[{required: true, message: "Enter your username"}]}
            >
              <Input prefix={<UserOutlined />} autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="Password"
              name="password"
              rules={[{required: true, message: "Enter your password"}]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                autoComplete="current-password"
              />
            </Form.Item>
            {error && <Alert className="form-alert" type="error" showIcon message={error} />}
            <Button type="primary" htmlType="submit" size="large" block>
              Sign in
            </Button>
          </Form>
        </div>
      </section>
    </main>
  );
}
