export type AssetBody = string | Uint8Array;
export type AssetRecord = Readonly<{ body: AssetBody; mediaType?: string; cacheControl?: string | false; provenance?: unknown }>;
export type AssetInventory = Iterable<readonly [string, AssetBody | AssetRecord] | Readonly<{ path: string; body: AssetBody; mediaType?: string; cacheControl?: string | false; provenance?: unknown }>>;
export type BrowserAssetMapping = Readonly<{ source: string; path: string; bytes: number; digest: string; integrity: string }>;
export type BrowserAssetManifest = Readonly<{ kind: 'browser-asset-manifest'; version: 1; assets: readonly BrowserAssetMapping[] }>;
export type BrowserAssetDiagnostic = Readonly<{ severity: 'error'; code: string; message: string; subject: string }>;
export type BrowserAssetConfig = Readonly<{
  includePaths?: readonly string[]; excludePaths?: readonly string[]; extensions?: readonly string[];
  hashLength?: number; integrity?: boolean; manifestPath?: string | false;
}>;
export type TransformedArtifact = Readonly<{ path: string; body: AssetBody; mediaType?: string; cacheControl?: string | false; provenance?: unknown }>;

export function transformBrowserAssetInventory(options: Readonly<{ artifacts: AssetInventory; config?: BrowserAssetConfig }>): Readonly<{
  artifacts: readonly TransformedArtifact[]; mapping: readonly BrowserAssetMapping[];
  manifest: BrowserAssetManifest | null; diagnostics: readonly BrowserAssetDiagnostic[];
}>;
