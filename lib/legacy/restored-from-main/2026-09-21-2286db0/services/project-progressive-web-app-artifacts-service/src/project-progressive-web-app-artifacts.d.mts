export type PwaArtifactBody = string | Uint8Array;
export type PwaArtifactInventory = Iterable<readonly [string, PwaArtifactBody | { body: PwaArtifactBody }] | { path: string; body: PwaArtifactBody }>;

export type PwaProjectedArtifact = Readonly<{
  path: string;
  body: PwaArtifactBody;
  mediaType?: string;
  cacheControl?: string;
  source?: string;
}>;

export type PwaBuildDiagnostic = Readonly<{
  severity?: "error" | "warning" | "info";
  code: string;
  message: string;
  subject?: string;
  details?: unknown;
}>;

export type PwaBuildProjector<Context extends object = object> = Readonly<{
  name: string;
  priority?: number;
  project(context: Context): ProgressiveWebAppProjection | Promise<ProgressiveWebAppProjection>;
}>;

export type WebAppManifestIcon = Readonly<{
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}>;

export type ProgressiveWebAppConfig = Readonly<{
  manifestPath?: string;
  serviceWorkerPath?: string;
  cacheName?: string;
  cacheNamePrefix?: string;
  offlineFallback?: string | null;
  runtimeCaching?: boolean;
  skipWaiting?: boolean;
  claimClients?: boolean;
  offlineResponse?: Readonly<{ body?: string; status?: number; mediaType?: string }>;
  precache?: Readonly<{
    includePaths?: readonly string[];
    excludePaths?: readonly string[];
    additionalUrls?: readonly string[];
  }>;
  manifest: Readonly<{
    name: string;
    shortName?: string;
    description?: string;
    startUrl?: string;
    scope?: string;
    display?: string;
    backgroundColor?: string;
    themeColor?: string;
    orientation?: string;
    id?: string;
    lang?: string;
    dir?: string;
    categories?: readonly string[];
    icons?: readonly WebAppManifestIcon[];
  }>;
}>;

export type ProgressiveWebAppProjection = Readonly<{
  artifacts: readonly PwaProjectedArtifact[];
  diagnostics: readonly PwaBuildDiagnostic[];
}>;

export declare function projectProgressiveWebAppArtifacts(input?: {
  artifacts?: PwaArtifactInventory;
  config?: ProgressiveWebAppConfig;
}): ProgressiveWebAppProjection;

export declare function createProgressiveWebAppProjector(
  config?: ProgressiveWebAppConfig,
  options?: { name?: string; priority?: number },
): PwaBuildProjector<{ artifacts?: PwaArtifactInventory }>;
