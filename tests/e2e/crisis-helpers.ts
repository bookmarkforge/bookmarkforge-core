import type { Page } from "@playwright/test";

export interface RenderCrashResult {
  fallbackShown: boolean;
  headingShown: boolean;
  error?: string;
}

/**
 * Mounts a component that throws during render inside a fresh React root.
 * Dev mode resolves Vite's /@id/ modules; preview mode discovers the bundled
 * React chunks, so specs do not need to duplicate either import strategy.
 */
export async function mountRenderCrash(
  page: Page,
  preview: boolean,
  errorMessage = "E2E_CRISIS_RENDER_ERROR",
): Promise<RenderCrashResult> {
  return page.evaluate(
    async ({ preview: isPreview, errorMessage }) => {
      const error = errorMessage;
      try {
        const dynamicImport = (specifier: string): Promise<any> => import(specifier);
        let React: any;
        let createRoot: any;
        if (isPreview) {
          const hrefs = [...document.querySelectorAll('link[rel="modulepreload"]')].map(
            (link) => (link as HTMLLinkElement).href,
          );
          const manifestEl = document.getElementById("__BMF_INTEGRITY_MANIFEST__");
          if (manifestEl?.textContent) {
            try {
              const files = (JSON.parse(manifestEl.textContent) as { files?: Record<string, string> }).files ?? {};
              for (const path of Object.keys(files)) hrefs.push(new URL(path, location.href).href);
            } catch {
              // modulepreload links remain sufficient when the manifest is invalid.
            }
          }
          const unique = [...new Set(hrefs)];
          const manifest = manifestEl?.textContent
            ? (JSON.parse(manifestEl.textContent) as { files?: Record<string, string> })
            : { files: {} };
          const manifestFiles = manifest.files ?? {};
          const expectedIntegrity = (url: string): string => {
            const hash = manifestFiles[new URL(url, location.href).pathname];
            if (!hash) throw new Error(`React chunk missing from SRI manifest: ${url}`);
            return `sha256-${btoa(String.fromCodePoint(...Uint8Array.from(hash.match(/../g)!.map((pair) => parseInt(pair, 16)))))}`;
          };
          const verifyChunk = async (url: string): Promise<void> => {
            const response = await fetch(url, { credentials: "omit", cache: "no-store" });
            if (!response.ok) throw new Error(`React chunk unavailable: ${url} (${response.status})`);
            const bytes = await response.arrayBuffer();
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            const actual = btoa(String.fromCodePoint(...new Uint8Array(digest)));
            if (actual !== expectedIntegrity(url).slice("sha256-".length)) {
              throw new Error(`React chunk SRI mismatch: ${url}`);
            }
          };
          const pathOf = (url: string) => new URL(url).pathname;
          const clientUrl = unique.find((url) => /\/client-[^/]+\.js$/.test(pathOf(url)));
          const reactDomUrl = unique.find((url) => /\/react-dom-[^/]+\.js$/.test(pathOf(url)));
          if (!clientUrl || !reactDomUrl) {
            throw new Error(`React chunks not found (client=${clientUrl} react-dom=${reactDomUrl})`);
          }
          const reactDomText = await fetch(reactDomUrl).then((response) => response.text());
          const coreFile = reactDomText.match(/from\s*"\.\/(react-[^".]+\.js)"/)?.[1];
          if (!coreFile) throw new Error("react-dom chunk does not import React core");
          const reactCoreUrl = new URL(coreFile, reactDomUrl).href;
          await verifyChunk(reactDomUrl);
          await verifyChunk(clientUrl);
          await verifyChunk(reactCoreUrl);
          const reactFactory = (await dynamicImport(reactCoreUrl)).t;
          const clientFactory = (await dynamicImport(clientUrl)).t;
          React = reactFactory();
          createRoot = clientFactory().createRoot;
        } else {
          React = (await dynamicImport("/@id/react")).default;
          const clientModule = await dynamicImport("/@id/react-dom/client");
          createRoot = (clientModule.default ?? clientModule).createRoot;
        }

        const host = document.createElement("div");
        host.id = "e2e-render-crash-host";
        document.body.appendChild(host);
        const Thrower = () => {
          throw new Error(error);
        };
        let Boundary: any;
        if (isPreview) {
          class InlineBoundary extends React.Component {
            state = { hasError: false, error: null as Error | null };
            static getDerivedStateFromError(caught: Error) {
              return { hasError: true, error: caught };
            }
            render() {
              if (this.state.hasError) {
                return React.createElement(
                  "div",
                  { role: "alert", "aria-live": "assertive" },
                  React.createElement("h1", null, "Something went wrong"),
                  React.createElement("p", null, String(this.state.error?.message ?? "Unknown error")),
                );
              }
              return this.props.children;
            }
          }
          Boundary = InlineBoundary;
        } else {
          Boundary = (await dynamicImport("/src/components/ErrorBoundary.tsx")).ErrorBoundaryWrapper;
        }

        createRoot(host).render(React.createElement(Boundary, null, React.createElement(Thrower)));
        return await new Promise<RenderCrashResult>((resolve) => {
          const deadline = Date.now() + 8_000;
          const poll = () => {
            const text = host.textContent ?? "";
            const fallbackShown = text.includes(error);
            if (fallbackShown || Date.now() > deadline) {
              resolve({ fallbackShown, headingShown: text.includes("Something went wrong") });
              return;
            }
            setTimeout(poll, 100);
          };
          poll();
        });
      } catch (caught) {
        return { fallbackShown: false, headingShown: false, error: String(caught) };
      }
    },
    { preview, errorMessage },
  );
}
