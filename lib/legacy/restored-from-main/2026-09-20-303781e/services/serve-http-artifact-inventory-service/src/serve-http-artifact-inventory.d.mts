import type { App } from "@red-cup-engineering/http-server-application-contract-service";

export type ArtifactValue = string | Uint8Array;
export type ArtifactRecord = Readonly<{
  body: ArtifactValue;
  mediaType?: string;
  cacheControl?: string | false;
  etag?: string;
}>;

export type ArtifactInventoryOptions = Readonly<{
  index?: readonly string[];
  notFoundPath?: string | false;
  etag?: boolean;
  cacheControl?: string | false | ((path: string) => string | false | undefined);
  notFoundCacheControl?: string | false | ((path: string) => string | false | undefined);
}>;

/** Form one GET/HEAD HTTP application resource over a Map-like release inventory. */
export declare function artifactInventory(
  inventory: ReadonlyMap<string, ArtifactValue | ArtifactRecord>,
  options?: ArtifactInventoryOptions,
): App;
