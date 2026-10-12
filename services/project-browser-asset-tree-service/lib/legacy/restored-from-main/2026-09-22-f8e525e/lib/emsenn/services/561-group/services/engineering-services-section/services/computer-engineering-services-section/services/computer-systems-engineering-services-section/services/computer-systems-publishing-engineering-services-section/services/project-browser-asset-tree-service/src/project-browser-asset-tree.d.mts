/** Copy browser assets into a static tree, stripping `.mts` type syntax and omitting server/test source. */
export function copyStrippingMts(sourceDirectory: string, destinationDirectory: string): Promise<void>;
export type CloudflareStaticAssetCopy = Readonly<{ source: string; destination: string }>;
export declare function buildCloudflareStaticAssetTree(input: Readonly<{ rootDirectory: string; outputDirectory?: string; browserTrees?: readonly string[]; copies?: readonly CloudflareStaticAssetCopy[] }>): Promise<string>;
