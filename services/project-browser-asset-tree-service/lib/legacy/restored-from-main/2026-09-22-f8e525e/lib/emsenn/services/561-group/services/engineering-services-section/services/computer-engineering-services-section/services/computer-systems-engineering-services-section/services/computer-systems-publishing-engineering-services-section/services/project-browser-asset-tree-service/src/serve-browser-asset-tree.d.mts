export type BrowserAssetDevServerOptions = Readonly<{
  rootDirectory: string;
  vendorRoots?: Readonly<Record<string, string>>;
  manifest?: unknown;
}>;
export declare function createBrowserAssetDevServer(options: BrowserAssetDevServerOptions): import("node:http").Server;

export type DevServerPortOptions = Readonly<{
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  defaultPort: number;
}>;
export declare function configuredDevServerPort(options: DevServerPortOptions): number;
