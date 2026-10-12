export type StaticBrowserDevServerOptions = Readonly<{
  rootDirectory: string;
  vendorRoots?: Readonly<Record<string, string>>;
  frontDoor?: "redirect" | "pretty-urls";
}>;
export declare function createStaticBrowserDevServer(options: StaticBrowserDevServerOptions): import("node:http").Server;
