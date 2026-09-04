import { useEffect, useState } from "react";

import { getBuildInfo } from "./generated/contracts";
import type { AppErrorDto, BuildInfoDto } from "./generated/contracts";
import "./styles.css";

type BuildInfoState =
  | { status: "loading" }
  | { status: "ready"; info: BuildInfoDto }
  | { status: "error"; message: string };

export interface AppProps {
  loadBuildInfo?: () => Promise<BuildInfoDto>;
}

function isAppError(error: unknown): error is AppErrorDto {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export function App({ loadBuildInfo = getBuildInfo }: AppProps) {
  const [buildInfo, setBuildInfo] = useState<BuildInfoState>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;

    void loadBuildInfo()
      .then((info) => {
        if (active) {
          setBuildInfo({ status: "ready", info });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setBuildInfo({
            status: "error",
            message: isAppError(error)
              ? error.message
              : "The desktop command did not return build information.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [loadBuildInfo]);

  return (
    <main className="app-shell">
      <section className="welcome" aria-labelledby="flowshot-title">
        <p className="eyebrow">Local-first Markdown workspace</p>
        <h1 id="flowshot-title">Flowshot</h1>
        <p className="summary">
          Read your documents and keep durable annotations without changing the
          Markdown you own.
        </p>

        <div
          className="foundation-status"
          aria-live="polite"
          aria-atomic="true"
        >
          {buildInfo.status === "loading" && (
            <>
              <h2>Connecting to the desktop core</h2>
              <p>Loading build information…</p>
            </>
          )}

          {buildInfo.status === "ready" && (
            <>
              <h2>Foundation ready</h2>
              <dl className="build-details">
                <div>
                  <dt>Version</dt>
                  <dd>{buildInfo.info.version}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{buildInfo.info.gitSha}</dd>
                </div>
                <div>
                  <dt>Profile</dt>
                  <dd>{buildInfo.info.buildProfile}</dd>
                </div>
              </dl>
            </>
          )}

          {buildInfo.status === "error" && (
            <>
              <h2>Build information unavailable</h2>
              <p role="alert">{buildInfo.message}</p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
